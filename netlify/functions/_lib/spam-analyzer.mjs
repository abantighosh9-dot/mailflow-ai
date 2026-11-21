// Pre-Send Email Spam Score Analyzer for MailFlow AI

const SPAM_TRIGGER_WORDS = [
  "100% free",
  "100% satisfied",
  "act now",
  "all natural",
  "apply now",
  "bargain",
  "best price",
  "big bucks",
  "billion dollars",
  "bonus",
  "buy direct",
  "call free",
  "cash bonus",
  "cash prize",
  "claim your",
  "clearance",
  "click here",
  "click now",
  "congratulations",
  "credit card",
  "cure",
  "dear friend",
  "direct email",
  "double your",
  "earn extra cash",
  "earn money",
  "eliminate debt",
  "exclusive deal",
  "expect to earn",
  "extra income",
  "fast cash",
  "financial freedom",
  "free access",
  "free consultation",
  "free gift",
  "free info",
  "free sample",
  "free trial",
  "get out of debt",
  "get paid",
  "giveaway",
  "guaranteed",
  "hidden assets",
  "income from home",
  "increase sales",
  "instant",
  "investment",
  "join millions",
  "limited time",
  "lowest price",
  "make money",
  "millionaire",
  "miracle",
  "money back",
  "multi-level marketing",
  "no catch",
  "no cost",
  "no credit check",
  "no experience",
  "no fees",
  "no gimmick",
  "no hidden",
  "no obligation",
  "no purchase necessary",
  "no risk",
  "not spam",
  "once in a lifetime",
  "one time",
  "online marketing",
  "open immediately",
  "opportunity",
  "order now",
  "passwords",
  "pennies a day",
  "pure profit",
  "refinance",
  "risk-free",
  "save big",
  "special promotion",
  "terms and conditions",
  "unclaimed",
  "unlimited",
  "unsolicited",
  "urgent",
  "vacation",
  "valuable",
  "viagra",
  "vicodin",
  "winner",
  "winning",
  "work from home",
  "you have been selected",
  "zero percent"
];

const URL_SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "t.co",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "adf.ly",
  "bit.do",
  "cutt.ly"
];

const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "mail.com",
  "proton.me",
  "protonmail.com"
];

/**
 * Strips HTML tags and returns plain text.
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts links from HTML markup.
 */
function extractLinks(html) {
  if (!html) return [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  const links = [];
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/**
 * Analyzes an email draft for deliverability and spam filters.
 * Returns a score from 0 (very spammy) to 100 (clean), risk level, issues and actionable tips.
 */
export function analyzeEmailSpamScore({ subject = "", html = "", fromEmail = "" } = {}) {
  const issues = [];
  const suggestions = [];
  let score = 100;

  const plainText = stripHtml(html);
  const subjectTrimmed = (subject || "").trim();
  const links = extractLinks(html);

  // 1. Mandatory Unsubscribe Check
  const hasUnsubscribePlaceholder = /\{\{\s*unsubscribe_url\s*\}\}|\{\{\s*unsubscribe\s*\}\}/i.test(html);
  const hasUnsubscribeWord = /unsubscribe/i.test(plainText) || /unsubscribe/i.test(html);
  if (!hasUnsubscribePlaceholder && !hasUnsubscribeWord) {
    score -= 25;
    issues.push({
      category: "COMPLIANCE",
      severity: "CRITICAL",
      rule: "MISSING_UNSUBSCRIBE",
      message: "Missing mandatory unsubscribe link or {{unsubscribe_url}} placeholder."
    });
    suggestions.push("Add {{unsubscribe_url}} or an Unsubscribe link in the email footer to comply with CAN-SPAM and GDPR.");
  }

  // 2. Sender Domain Check
  if (fromEmail) {
    const fromDomain = fromEmail.split("@")[1]?.toLowerCase();
    if (fromDomain && FREE_EMAIL_DOMAINS.includes(fromDomain)) {
      score -= 15;
      issues.push({
        category: "AUTHENTICATION",
        severity: "WARNING",
        rule: "FREE_EMAIL_SENDER",
        message: `From address uses a free webmail service (@${fromDomain}).`
      });
      suggestions.push("Send marketing emails from your own domain (e.g. hello@yourbrand.com) with verified SPF & DKIM records instead of a free @gmail/@yahoo address.");
    }
  }

  // 3. Subject Line Analysis
  if (!subjectTrimmed) {
    score -= 20;
    issues.push({
      category: "SUBJECT",
      severity: "CRITICAL",
      rule: "EMPTY_SUBJECT",
      message: "Subject line is empty."
    });
    suggestions.push("Write a clear, concise subject line between 30 and 60 characters.");
  } else {
    // Excessive ALL CAPS in subject
    const lettersInSubject = subjectTrimmed.replace(/[^a-zA-Z]/g, "");
    if (lettersInSubject.length > 5) {
      const upperCount = subjectTrimmed.replace(/[^A-Z]/g, "").length;
      const upperRatio = upperCount / lettersInSubject.length;
      if (upperRatio > 0.35) {
        score -= 15;
        issues.push({
          category: "SUBJECT",
          severity: "WARNING",
          rule: "SUBJECT_ALL_CAPS",
          message: `Subject line contains ${Math.round(upperRatio * 100)}% uppercase characters.`
        });
        suggestions.push("Avoid using ALL-CAPS words in your subject line; write in sentence case or title case.");
      }
    }

    // Exclamation mark abuse in subject
    const exclamationsInSubject = (subjectTrimmed.match(/!/g) || []).length;
    if (exclamationsInSubject > 1) {
      score -= 10;
      issues.push({
        category: "SUBJECT",
        severity: "WARNING",
        rule: "SUBJECT_EXCLAMATION",
        message: `Subject line contains ${exclamationsInSubject} exclamation marks.`
      });
      suggestions.push("Remove multiple exclamation marks from your subject line. Use at most one or none.");
    }

    // Spam words in subject
    const lowerSubject = subjectTrimmed.toLowerCase();
    const foundSubjectTriggers = SPAM_TRIGGER_WORDS.filter(w => lowerSubject.includes(w));
    if (foundSubjectTriggers.length > 0) {
      score -= Math.min(25, foundSubjectTriggers.length * 10);
      issues.push({
        category: "SUBJECT",
        severity: "WARNING",
        rule: "SUBJECT_SPAM_WORDS",
        message: `Spam trigger phrase(s) in subject line: "${foundSubjectTriggers.slice(0, 3).join('", "')}".`
      });
      suggestions.push(`Replace promotional triggers like "${foundSubjectTriggers[0]}" with benefit-oriented, natural phrasing.`);
    }

    // Subject length check
    if (subjectTrimmed.length > 80) {
      score -= 5;
      issues.push({
        category: "SUBJECT",
        severity: "INFO",
        rule: "SUBJECT_TOO_LONG",
        message: `Subject line is ${subjectTrimmed.length} characters (recommended: 30-60).`
      });
      suggestions.push("Shorten your subject line so it doesn't get truncated on mobile devices.");
    }
  }

  // 4. Body Content Analysis
  const lowerBody = plainText.toLowerCase();

  // Spam trigger words in body
  const foundBodyTriggers = SPAM_TRIGGER_WORDS.filter(w => lowerBody.includes(w));
  if (foundBodyTriggers.length >= 3) {
    const penalty = Math.min(20, foundBodyTriggers.length * 4);
    score -= penalty;
    issues.push({
      category: "CONTENT",
      severity: "WARNING",
      rule: "BODY_SPAM_WORDS",
      message: `Found ${foundBodyTriggers.length} potential spam triggers in email body: "${foundBodyTriggers.slice(0, 4).join('", "')}".`
    });
    suggestions.push("Review and tone down hype phrases in your message to improve inbox placement.");
  }

  // Excessive consecutive punctuation in body (e.g. !!!, ???, !?!)
  if (/!{2,}|\?{2,}|!\?|\?!/.test(plainText)) {
    score -= 10;
    issues.push({
      category: "CONTENT",
      severity: "WARNING",
      rule: "EXCESSIVE_PUNCTUATION",
      message: "Found repeated punctuation marks (e.g. '!!' or '??') in body."
    });
    suggestions.push("Limit punctuation to single marks per sentence.");
  }

  // 5. URL Shorteners and Link Quality
  const suspiciousUrls = links.filter(link => {
    const lower = link.toLowerCase();
    return URL_SHORTENERS.some(shortener => lower.includes(shortener)) || /https?:\/\/\d+\.\d+\.\d+\.\d+/i.test(link);
  });

  if (suspiciousUrls.length > 0) {
    score -= 20;
    issues.push({
      category: "LINKS",
      severity: "CRITICAL",
      rule: "SUSPICIOUS_SHORTENED_URLS",
      message: `Email contains shortened or IP-based links (${suspiciousUrls.slice(0, 2).join(", ")}).`
    });
    suggestions.push("Replace shortened links (bit.ly, tinyurl) with your own branded domain URLs to avoid triggering spam filters.");
  }

  // Excessive link density
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  if (links.length > 15 || (wordCount > 0 && links.length > 5 && links.length / (wordCount / 10) > 1)) {
    score -= 10;
    issues.push({
      category: "LINKS",
      severity: "INFO",
      rule: "HIGH_LINK_DENSITY",
      message: `High number of links (${links.length} links for ~${wordCount} words).`
    });
    suggestions.push("Focus your email on 1 to 3 primary calls-to-action (CTAs) instead of cluttering with numerous links.");
  }

  // 6. Image-to-Text Balance
  const imgTags = (html.match(/<img\b/gi) || []).length;
  if (imgTags > 2 && wordCount < 30) {
    score -= 15;
    issues.push({
      category: "CONTENT",
      severity: "WARNING",
      rule: "IMAGE_HEAVY_NO_TEXT",
      message: `Email contains ${imgTags} images but only ${wordCount} words of text.`
    });
    suggestions.push("Include sufficient descriptive text alongside images; spam filters flag image-only emails.");
  }

  // 7. Physical Mailing Address Check
  const hasPhysicalAddress = /\{\{\s*company_address\s*\}\}|suite|street|ave|road|postal|blvd|p\.?o\.?\s*box/i.test(lowerBody);
  if (!hasPhysicalAddress && wordCount > 20) {
    score -= 5;
    issues.push({
      category: "COMPLIANCE",
      severity: "INFO",
      rule: "MISSING_PHYSICAL_ADDRESS",
      message: "No physical business address detected in the email footer."
    });
    suggestions.push("Include your company's physical postal address or {{company_address}} token to satisfy CAN-SPAM requirements.");
  }

  // Clamp final score
  const finalScore = Math.max(0, Math.min(100, score));

  // Determine risk level
  let riskLevel = "LOW";
  if (finalScore < 50) {
    riskLevel = "HIGH";
  } else if (finalScore < 80) {
    riskLevel = "MEDIUM";
  }

  let summary = "Email looks great! Excellent deliverability indicators.";
  if (riskLevel === "HIGH") {
    summary = "High spam risk detected. Please resolve critical compliance and content issues before sending.";
  } else if (riskLevel === "MEDIUM") {
    summary = "Moderate risk. Addressing the suggested improvements will help ensure optimal inbox delivery.";
  }

  return {
    score: finalScore,
    riskLevel,
    summary,
    issues,
    suggestions: suggestions.slice(0, 5)
  };
}
