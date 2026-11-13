import serverless from "serverless-http";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const app = express();
const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "lax", path: "/", maxAge: 7 * 24 * 60 * 60 * 1000
};
function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("mf_session", token, cookieOptions);
}
async function auth(req,res,next) {
  try {
    const token=req.cookies?.mf_session || req.headers.authorization?.replace("Bearer ","");
    if(!token) return res.status(401).json({error:"Please sign in."});
    const payload=jwt.verify(token,process.env.JWT_SECRET);
    const user=await prisma.user.findUnique({where:{id:payload.sub},include:{memberships:{include:{workspace:true}}}});
    if(!user) return res.status(401).json({error:"Account not found."});
    req.user=user; req.workspace=user.memberships[0]?.workspace; next();
  } catch { return res.status(401).json({error:"Your session has expired. Please sign in again."}); }
}
app.use((req,res,next)=>{ // Minimal cookie parser, avoiding another dependency
  const raw=req.headers.cookie||"";
  req.cookies=Object.fromEntries(raw.split(";").filter(Boolean).map(p=>{const i=p.indexOf("=");return [p.slice(0,i).trim(),decodeURIComponent(p.slice(i+1).trim())]}));
  next();
});
async function createWorkspace(user,name) {
  const workspace=await prisma.workspace.create({data:{name}});
  await prisma.workspaceMember.create({data:{userId:user.id,workspaceId:workspace.id,role:"OWNER"}});
  return workspace;
}
const registerSchema=z.object({name:z.string().min(2).max(80),email:z.email(),password:z.string().min(8).max(100)});
app.post("/auth/register",async(req,res)=>{
  const parsed=registerSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Enter a valid name, email and password of at least 8 characters."});
  const {name,email,password}=parsed.data;
  try{
    const passwordHash=await bcrypt.hash(password,12);
    const user=await prisma.user.create({data:{name,email:email.toLowerCase(),passwordHash}});
    await createWorkspace(user,`${name}'s Workspace`); issueSession(res,user);
    return res.status(201).json({user:{id:user.id,name:user.name,email:user.email}});
  }catch(e){return res.status(409).json({error:"An account with this email may already exist."});}
});
app.post("/auth/login",async(req,res)=>{
  const email=String(req.body.email||"").toLowerCase(); const password=String(req.body.password||"");
  const user=await prisma.user.findUnique({where:{email}});
  if(!user?.passwordHash || !(await bcrypt.compare(password,user.passwordHash)))return res.status(401).json({error:"Incorrect email or password."});
  issueSession(res,user); return res.json({user:{id:user.id,name:user.name,email:user.email}});
});
app.post("/auth/google",async(req,res)=>{
  try{
    if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:"Google login is not configured yet."});
    const ticket=await googleClient.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID});
    const p=ticket.getPayload();
    if(!p?.email || !p.email_verified)return res.status(401).json({error:"Google account email is not verified."});
    let user=await prisma.user.findUnique({where:{email:p.email.toLowerCase()},include:{memberships:true}});
    if(user){
      if(user.googleSub && user.googleSub!==p.sub)return res.status(409).json({error:"This email is linked to a different Google identity."});
      user=await prisma.user.update({where:{id:user.id},data:{googleSub:p.sub,avatarUrl:p.picture||user.avatarUrl}});
    }else{
      user=await prisma.user.create({data:{name:p.name||p.email.split("@")[0],email:p.email.toLowerCase(),googleSub:p.sub,avatarUrl:p.picture}});
      await createWorkspace(user,`${user.name}'s Workspace`);
    }
    issueSession(res,user); return res.json({user:{id:user.id,name:user.name,email:user.email}});
  }catch{return res.status(401).json({error:"Google sign-in could not be verified."});}
});
app.get("/auth/me",auth,async(req,res)=>res.json({user:{id:req.user.id,name:req.user.name,email:req.user.email}}));
app.post("/auth/logout",(req,res)=>{res.clearCookie("mf_session",{...cookieOptions,maxAge:0});res.json({ok:true});});

app.get("/dashboard",auth,async(req,res)=>{
 const workspaceId=req.workspace?.id;
 if(!workspaceId)return res.status(400).json({error:"No workspace is assigned to this account."});
 const [contacts,campaigns,templates,sent]=await Promise.all([
  prisma.contact.count({where:{workspaceId}}),
  prisma.campaign.count({where:{workspaceId}}),
  prisma.emailTemplate.count({where:{workspaceId}}),
  prisma.campaign.count({where:{workspaceId,status:"SENT"}})
 ]);
 res.json({stats:{contacts,campaigns,templates,sent}});
});

const emailSchema=z.object({
 prompt:z.string().min(10).max(3000),purpose:z.string().max(80),tone:z.string().max(80),
 audience:z.string().max(160),brandName:z.string().max(100).optional(),language:z.string().max(50).optional()
});
app.post("/ai/generate-email",auth,async(req,res)=>{
 const parsed=emailSchema.safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:"Please provide a campaign description of at least 10 characters."});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"AI generation is not configured. Add OPENAI_API_KEY to your environment."});
 try{
  const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const {prompt,purpose,tone,audience,brandName="Your Brand",language="English"}=parsed.data;
  const response=await openai.responses.create({
   model:process.env.OPENAI_MODEL||"gpt-6-astra",
   input:[
    {role:"system",content:"You are an expert lifecycle email marketer and email designer. Create persuasive, honest, accessible, responsive email content. Never invent product claims, prices, guarantees, testimonials, or discounts not supplied by the user. Return only the requested structured email. Use concise, useful copy. Do not include tracking pixels or deceptive links. The footer must remind the sender to include their real postal address and a working unsubscribe link."},
    {role:"user",content:`Create a complete marketing email. Brand: ${brandName}. Purpose: ${purpose}. Audience: ${audience}. Tone: ${tone}. Language: ${language}. Brief: ${prompt}. Generate a strong subject line, preview text, headline, 2-3 content sections, CTA label, footer, and accessible color palette.`}
   ],
   text:{format:{type:"json_schema",name:"mailflow_email",strict:true,schema:{
    type:"object",additionalProperties:false,
    properties:{
     subject:{type:"string"},previewText:{type:"string"},headline:{type:"string"},
     sections:{type:"array",items:{type:"object",additionalProperties:false,properties:{heading:{type:"string"},body:{type:"string"}},required:["heading","body"]}},
     ctaText:{type:"string"},footer:{type:"string"},
     colors:{type:"object",additionalProperties:false,properties:{background:{type:"string"},accent:{type:"string"},text:{type:"string"}},required:["background","accent","text"]}
    },required:["subject","previewText","headline","sections","ctaText","footer","colors"]
   }}}
  });
  const email=JSON.parse(response.output_text);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const sections=email.sections.map(s=>`<tr><td style="padding:18px 28px;font-family:Arial,sans-serif;color:${esc(email.colors.text)}"><h2>${esc(s.heading)}</h2><p style="line-height:1.6">${esc(s.body)}</p></td></tr>`).join("");
  email.html=`<!doctype html><html><body style="margin:0;background:${esc(email.colors.background)}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:30px 12px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:12px" cellspacing="0" cellpadding="0"><tr><td style="padding:30px 28px;font-family:Arial,sans-serif;color:${esc(email.colors.text)}"><p style="font-size:12px;letter-spacing:2px">${esc(brandName)}</p><h1>${esc(email.headline)}</h1><p>${esc(email.previewText)}</p></td></tr>${sections}<tr><td align="center" style="padding:25px"><a href="#" style="background:${esc(email.colors.accent)};color:#fff;padding:14px 26px;text-decoration:none;border-radius:6px;display:inline-block">${esc(email.ctaText)}</a></td></tr><tr><td style="padding:24px;font:12px Arial;color:#777">${esc(email.footer)}<br/>[Company postal address] · <a href="{{unsubscribe_url}}">Unsubscribe</a></td></tr></table></td></tr></table></body></html>`;
  res.json({email});
 }catch(e){console.error("AI generation failed",e);res.status(502).json({error:"AI generation failed. Check your API key, model access and usage limits."});}
});

app.post("/templates",auth,async(req,res)=>{
 const {name,email}=req.body||{};
 if(!name||!email?.html)return res.status(400).json({error:"Template name and generated email are required."});
 const saved=await prisma.emailTemplate.create({data:{workspaceId:req.workspace.id,name:String(name).slice(0,120),subject:email.subject||"",previewText:email.previewText||"",content:email,html:email.html}});
 res.status(201).json({template:saved});
});
app.get("/templates",auth,async(req,res)=>{
 const templates=await prisma.emailTemplate.findMany({where:{workspaceId:req.workspace.id},orderBy:{createdAt:"desc"}});
 res.json({templates});
});
app.get("/health",(_req,res)=>res.json({ok:true,service:"MailFlow AI API"}));

export const handler=serverless(app);
