// MailFlow AI — Starter Email Templates
// Clean, responsive, email-client-friendly designs with inline styles and zero external dependencies.

export const STARTER_TEMPLATES = [
  {
    id: "starter-welcome",
    name: "Welcome Onboarding Guide",
    category: "Welcome",
    subject: "Welcome to {{company}} — Let's get you set up!",
    previewText: "3 quick steps to help you get the most out of your new account.",
    description: "Engaging welcome email with numbered onboarding steps and a clear call-to-action.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to {{company}}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px; background: linear-gradient(135deg, #6545bc 0%, #4a2fa3 100%); text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Welcome to {{company}} 👋</h1>
              <p style="margin: 8px 0 0; color: #e2dafa; font-size: 14px;">We're thrilled to have you with us, {{firstName}}.</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #4e5568;">
                Hello {{firstName}},
              </p>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 28px; color: #4e5568;">
                Thanks for joining us! We built {{company}} to make email communication simple, beautiful, and remarkably effective. Here are three quick steps to help you hit the ground running:
              </p>

              <!-- Step 1 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; background-color: #f9f8fe; border-radius: 8px; padding: 16px;">
                <tr>
                  <td width="36" valign="top">
                    <div style="background-color: #6545bc; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-weight: 700; font-size: 13px;">1</div>
                  </td>
                  <td style="padding-left: 12px;">
                    <h3 style="margin: 0 0 4px; font-size: 15px; color: #20243a;">Import your subscriber audience</h3>
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #60677a;">Easily import your contacts via CSV or sync with your existing customer list.</p>
                  </td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 20px; background-color: #f9f8fe; border-radius: 8px; padding: 16px;">
                <tr>
                  <td width="36" valign="top">
                    <div style="background-color: #6545bc; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-weight: 700; font-size: 13px;">2</div>
                  </td>
                  <td style="padding-left: 12px;">
                    <h3 style="margin: 0 0 4px; font-size: 15px; color: #20243a;">Pick or customize a template</h3>
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #60677a;">Select from ready-to-use email templates and preview across desktop & mobile.</p>
                  </td>
                </tr>
              </table>

              <!-- Step 3 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 32px; background-color: #f9f8fe; border-radius: 8px; padding: 16px;">
                <tr>
                  <td width="36" valign="top">
                    <div style="background-color: #6545bc; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; text-align: center; line-height: 28px; font-weight: 700; font-size: 13px;">3</div>
                  </td>
                  <td style="padding-left: 12px;">
                    <h3 style="margin: 0 0 4px; font-size: 15px; color: #20243a;">Launch your first campaign</h3>
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #60677a;">Send immediately or schedule for optimal delivery across timezones.</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://mailflow.ai/app" style="display: inline-block; background-color: #6545bc; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px;">Get Started Now →</a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 13px; line-height: 1.6; margin: 32px 0 0; color: #81869a; text-align: center;">
                Need help? Just reply to this email — our support team is always ready to assist.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0 0 8px;">© {{company}} · All rights reserved.</p>
              <p style="margin: 0;">
                You received this email because you registered on our platform.
                <br>
                {{unsubscribe}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-newsletter",
    name: "Monthly Community Newsletter",
    category: "Newsletter",
    subject: "{{company}} Dispatch: This Month's Top Stories & Highlights",
    previewText: "Curated insights, feature releases, and community spotlights.",
    description: "Editorial newsletter layout featuring a lead story, secondary articles, and callout tips.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{company}} Newsletter</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <!-- Masthead -->
          <tr>
            <td style="padding: 28px 40px; border-bottom: 2px solid #6545bc; background-color: #ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 800; color: #6545bc; letter-spacing: -0.5px;">{{company}}</span>
                    <span style="font-size: 12px; color: #8b91a3; margin-left: 8px;">| MONTHLY DISPATCH</span>
                  </td>
                  <td align="right" style="font-size: 12px; color: #8b91a3;">
                    Issue #24
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Featured Story -->
          <tr>
            <td style="padding: 36px 40px 24px;">
              <span style="display: inline-block; background-color: #f0edfc; color: #6545bc; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">FEATURED ARTICLE</span>
              <h2 style="font-size: 22px; font-weight: 800; margin: 0 0 14px; color: #20243a; line-height: 1.3;">
                How to Boost Inbox Placement by 40% with Modern Authentication
              </h2>
              <p style="font-size: 14px; line-height: 1.6; color: #4e5568; margin: 0 0 18px;">
                Email deliverability in 2026 demands strict domain authentication, consistent sending cadence, and automated bounce handling. Here's our complete blueprint for achieving inbox perfection.
              </p>
              <a href="https://mailflow.ai" style="color: #6545bc; font-weight: 700; font-size: 13px; text-decoration: none;">Read full guide →</a>
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;"><hr style="border: 0; border-top: 1px solid #edf0f6; margin: 0;"></td>
          </tr>
          <!-- Secondary Articles Grid -->
          <tr>
            <td style="padding: 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" valign="top">
                    <h3 style="font-size: 16px; margin: 0 0 8px; color: #20243a;">⚡ Product Changelog</h3>
                    <p style="font-size: 13px; line-height: 1.5; color: #60677a; margin: 0 0 10px;">
                      Scheduled background sending is now live with exponential backoff and rate-limit safeguards.
                    </p>
                    <a href="https://mailflow.ai" style="color: #6545bc; font-size: 12px; font-weight: 700; text-decoration: none;">View changelog →</a>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" valign="top">
                    <h3 style="font-size: 16px; margin: 0 0 8px; color: #20243a;">💡 Pro Tip</h3>
                    <p style="font-size: 13px; line-height: 1.5; color: #60677a; margin: 0 0 10px;">
                      Use dynamic personalization tags like {{firstName}} to increase open and engagement rates.
                    </p>
                    <a href="https://mailflow.ai" style="color: #6545bc; font-size: 12px; font-weight: 700; text-decoration: none;">Learn more →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Callout Box -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f5ff; border: 1px solid #e9e3ff; border-radius: 8px; padding: 20px;">
                <tr>
                  <td>
                    <b style="color: #6545bc; font-size: 14px;">Have questions or feedback?</b>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #4e5568;">Hit reply to share your thoughts directly with our editorial and engineering team.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0 0 8px;">© {{company}} · Sent with care to {{email}}</p>
              <p style="margin: 0;">{{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-launch",
    name: "New Product Release Announcement",
    category: "Product Launch",
    subject: "Introducing our newest platform update: Faster, smarter & reliable",
    previewText: "Discover the newest features we just unlocked for your team.",
    description: "High-impact announcement template for major features, products, or version releases.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Launch</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <!-- Hero -->
          <tr>
            <td style="padding: 44px 40px; text-align: center; background: radial-gradient(circle at 50% 20%, #7657d6 0%, #4a2fa3 100%);">
              <span style="display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff; font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 20px; letter-spacing: 1px; text-transform: uppercase;">NOW LIVE</span>
              <h1 style="color: #ffffff; font-size: 28px; font-weight: 800; margin: 16px 0 10px; line-height: 1.2;">Next-Gen Delivery Automation</h1>
              <p style="color: #e2dafa; font-size: 15px; margin: 0 auto; max-width: 440px; line-height: 1.5;">Built to scale effortlessly from your first subscriber to your millionth.</p>
            </td>
          </tr>
          <!-- Highlights -->
          <tr>
            <td style="padding: 40px;">
              <p style="font-size: 15px; line-height: 1.6; color: #4e5568; margin: 0 0 24px;">
                Hi {{firstName}},
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #4e5568; margin: 0 0 32px;">
                We are thrilled to announce our latest milestone. Over the past several months, we have rebuilt our background campaign dispatch engine from the ground up:
              </p>

              <!-- Feature List -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td width="28" valign="top" style="color: #2caa76; font-size: 18px; font-weight: 800;">✓</td>
                  <td style="padding-left: 10px; padding-bottom: 16px;">
                    <b style="color: #20243a; font-size: 14px;">Automatic Background Dispatch</b>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #60677a;">Campaigns send automatically at scheduled times without requiring an open browser window.</p>
                  </td>
                </tr>
                <tr>
                  <td width="28" valign="top" style="color: #2caa76; font-size: 18px; font-weight: 800;">✓</td>
                  <td style="padding-left: 10px; padding-bottom: 16px;">
                    <b style="color: #20243a; font-size: 14px;">Adaptive Rate Limiting</b>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #60677a;">Automatic cooldowns prevent rate-limit bans and ensure steady delivery queues.</p>
                  </td>
                </tr>
                <tr>
                  <td width="28" valign="top" style="color: #2caa76; font-size: 18px; font-weight: 800;">✓</td>
                  <td style="padding-left: 10px;">
                    <b style="color: #20243a; font-size: 14px;">Comprehensive Analytics</b>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #60677a;">Track delivery rates, open funnels, and failure diagnostics in real time.</p>
                  </td>
                </tr>
              </table>

              <!-- Action Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 32px;">
                <tr>
                  <td align="center">
                    <a href="https://mailflow.ai/app" style="display: inline-block; background-color: #6545bc; color: #ffffff; padding: 14px 34px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(101,69,188,0.25);">Explore What's New →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0 0 8px;">{{company}} · Engineered for email excellence</p>
              <p style="margin: 0;">{{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-promo",
    name: "Limited-Time Promotional Offer",
    category: "Promotional",
    subject: "Special Offer: 25% off for {{company}} subscribers this week only",
    previewText: "Upgrade your account with our exclusive code SAVE25.",
    description: "High-conversion promotional email with discount pill, coupon box, and prominent call to action.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exclusive Promo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <!-- Banner -->
          <tr>
            <td style="padding: 12px; background-color: #fef3c7; color: #92400e; font-size: 12px; font-weight: 700; text-align: center; letter-spacing: 0.5px;">
              ⏰ LIMITED TIME OFFER · EXPIRES THIS SUNDAY
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 40px; text-align: center;">
              <h1 style="font-size: 32px; font-weight: 800; color: #6545bc; margin: 0 0 12px;">Save 25% on Pro</h1>
              <p style="font-size: 15px; color: #4e5568; line-height: 1.6; margin: 0 auto 28px; max-width: 440px;">
                Hey {{firstName}}, unlock unlimited campaign sends, advanced deliverability tracking, and AI-powered template generation.
              </p>

              <!-- Coupon Box -->
              <div style="background-color: #f7f5ff; border: 2px dashed #bbaaf2; border-radius: 10px; padding: 18px; margin: 0 auto 30px; max-width: 320px;">
                <span style="display: block; font-size: 11px; color: #8b91a3; font-weight: 600; text-transform: uppercase;">USE COUPON CODE AT CHECKOUT</span>
                <span style="display: block; font-size: 24px; font-weight: 800; color: #6545bc; letter-spacing: 2px; margin-top: 4px;">SAVE25</span>
              </div>

              <!-- Button -->
              <a href="https://mailflow.ai/pricing" style="display: inline-block; background-color: #6545bc; color: #ffffff; padding: 15px 36px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(101,69,188,0.25);">Claim Your 25% Discount →</a>

              <p style="font-size: 12px; color: #9a9eac; margin: 24px 0 0;">
                Valid for new and existing accounts. Discount applies for the first 12 months.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0 0 8px;">{{company}} · You are receiving this as an active subscriber.</p>
              <p style="margin: 0;">{{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-event",
    name: "Webinar & Event Invitation",
    category: "Event Invitation",
    subject: "You're Invited: Live Masterclass on Email Deliverability",
    previewText: "Reserve your seat for our upcoming expert masterclass.",
    description: "Event invite with date badge, key learning bullets, and reservation button.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <!-- Header -->
          <tr>
            <td style="padding: 36px 40px; background-color: #20243a; text-align: center;">
              <span style="color: #a78bfa; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">LIVE WEBINAR</span>
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 12px 0 8px;">The Email Deliverability Blueprint</h1>
              <p style="color: #94a3b8; font-size: 14px; margin: 0;">Join industry leaders for an exclusive 45-minute live session.</p>
            </td>
          </tr>
          <!-- Event Details Card -->
          <tr>
            <td style="padding: 32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 28px;">
                <tr>
                  <td width="50%">
                    <span style="font-size: 11px; color: #64748b; font-weight: 700;">WHEN</span>
                    <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 4px;">Thursday, 2:00 PM EST</div>
                  </td>
                  <td width="50%">
                    <span style="font-size: 11px; color: #64748b; font-weight: 700;">WHERE</span>
                    <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 4px;">Live Online (Interactive Q&A)</div>
                  </td>
                </tr>
              </table>

              <p style="font-size: 14px; line-height: 1.6; color: #4e5568; margin: 0 0 16px;">
                Hi {{firstName}},
              </p>
              <p style="font-size: 14px; line-height: 1.6; color: #4e5568; margin: 0 0 20px;">
                During this live masterclass, you will learn practical steps to configure SPF/DKIM/DMARC, maintain pristine domain reputation, and bypass spam filters.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
                <tr>
                  <td align="center">
                    <a href="https://mailflow.ai/webinar" style="display: inline-block; background-color: #6545bc; color: #ffffff; padding: 14px 34px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px;">Reserve My Free Seat →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0 0 8px;">{{company}} · Can't make it live? Register anyway to receive the recording.</p>
              <p style="margin: 0;">{{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-announcement",
    name: "Executive Platform Announcement",
    category: "Announcement",
    subject: "Important Platform Announcement from {{company}}",
    previewText: "A brief message from our leadership team.",
    description: "Clean letterhead style for executive updates, policy changes, or system improvements.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Important Announcement</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <tr>
            <td style="padding: 40px;">
              <div style="font-size: 18px; font-weight: 800; color: #6545bc; margin-bottom: 24px;">{{company}}</div>
              <h1 style="font-size: 22px; font-weight: 800; color: #20243a; margin: 0 0 20px; line-height: 1.3;">
                An update on our infrastructure and security commitments
              </h1>

              <p style="font-size: 14px; line-height: 1.7; color: #4e5568; margin: 0 0 16px;">
                Dear {{firstName}},
              </p>
              <p style="font-size: 14px; line-height: 1.7; color: #4e5568; margin: 0 0 16px;">
                As part of our continuing commitment to high availability and data sovereignty, we have successfully migrated our delivery queues to isolated clusters with active multi-zone replication.
              </p>
              <p style="font-size: 14px; line-height: 1.7; color: #4e5568; margin: 0 0 24px;">
                No action is required on your part. All existing campaign schedules, webhook listeners, and contact lists remain fully operational without downtime.
              </p>

              <div style="margin-top: 32px; border-top: 1px solid #f0f1f5; padding-top: 20px;">
                <b style="color: #20243a; font-size: 14px; display: block;">The Leadership Team</b>
                <span style="color: #8b91a3; font-size: 12px;">{{company}}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0;">{{company}} · {{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  },
  {
    id: "starter-followup",
    name: "Customer Feedback & Follow-up",
    category: "Follow-up",
    subject: "Quick question about your experience with {{company}}",
    previewText: "We'd love your thoughts on how we can improve.",
    description: "Conversational check-in template encouraging direct feedback or quick survey response.",
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Feedback</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #20243a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f8fb; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 600px;">
          <tr>
            <td style="padding: 40px;">
              <p style="font-size: 15px; line-height: 1.6; color: #4e5568; margin: 0 0 16px;">
                Hi {{firstName}},
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #4e5568; margin: 0 0 20px;">
                You've been using {{company}} for a few weeks now, and we'd love to know how things are going. How would you rate your overall experience so far?
              </p>

              <!-- Rating Scale -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 0 6px;">
                          <a href="https://mailflow.ai/feedback?score=1" style="display: block; width: 44px; height: 44px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; line-height: 44px; font-weight: 700; color: #64748b; text-decoration: none; font-size: 15px;">1</a>
                        </td>
                        <td style="padding: 0 6px;">
                          <a href="https://mailflow.ai/feedback?score=2" style="display: block; width: 44px; height: 44px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; line-height: 44px; font-weight: 700; color: #64748b; text-decoration: none; font-size: 15px;">2</a>
                        </td>
                        <td style="padding: 0 6px;">
                          <a href="https://mailflow.ai/feedback?score=3" style="display: block; width: 44px; height: 44px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; line-height: 44px; font-weight: 700; color: #64748b; text-decoration: none; font-size: 15px;">3</a>
                        </td>
                        <td style="padding: 0 6px;">
                          <a href="https://mailflow.ai/feedback?score=4" style="display: block; width: 44px; height: 44px; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; line-height: 44px; font-weight: 700; color: #64748b; text-decoration: none; font-size: 15px;">4</a>
                        </td>
                        <td style="padding: 0 6px;">
                          <a href="https://mailflow.ai/feedback?score=5" style="display: block; width: 44px; height: 44px; background-color: #6545bc; border: 1px solid #6545bc; border-radius: 8px; text-align: center; line-height: 44px; font-weight: 700; color: #ffffff; text-decoration: none; font-size: 15px;">5</a>
                        </td>
                      </tr>
                    </table>
                    <div style="display: flex; justify-content: space-between; max-width: 260px; margin: 8px auto 0; font-size: 11px; color: #94a3b8;">
                      <span>Needs Work</span>
                      <span style="margin-left: auto;">Fantastic!</span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="font-size: 14px; line-height: 1.6; color: #4e5568; margin: 0 0 20px;">
                You can also simply reply directly to this email with any feedback or feature requests. We read every response.
              </p>

              <p style="font-size: 14px; line-height: 1.6; color: #20243a; font-weight: 700; margin: 24px 0 0;">
                Best regards,<br>
                The {{company}} Customer Team
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; background-color: #fafbfe; border-top: 1px solid #f0f1f5; text-align: center; font-size: 12px; color: #8b91a3;">
              <p style="margin: 0;">{{company}} · {{unsubscribe}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  }
];

export const TEMPLATE_CATEGORIES = [
  "Welcome",
  "Newsletter",
  "Promotional",
  "Product Launch",
  "Announcement",
  "Event Invitation",
  "Follow-up",
  "Custom"
];
