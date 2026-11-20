// Brevo (formerly Sendinblue) Transactional Email Service Module
// Communicates with Brevo REST API v3: https://api.brevo.com/v3/smtp/email

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Validates basic email format
 */
function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Sends a single transactional email via Brevo REST API.
 *
 * @param {Object} options
 * @param {Object} options.sender - { name?: string, email: string }
 * @param {Array<{email: string, name?: string}>|Object|string} options.to - Recipient(s)
 * @param {string} options.subject - Email subject line
 * @param {string} options.htmlContent - HTML body content
 * @param {string} [options.textContent] - Optional plain text fallback
 * @param {Object} [options.headers] - Custom RFC headers (e.g. List-Unsubscribe)
 * @param {string[]} [options.tags] - Optional tracking/campaign tags
 * @param {Object} [options.replyTo] - Optional reply-to { email, name }
 * @param {string} [options.apiKey] - Optional explicit API key override (defaults to process.env.BREVO_API_KEY)
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string, code?: string, status?: number }>}
 */
export async function sendTransactionalEmail({
  sender,
  to,
  subject,
  htmlContent,
  textContent,
  headers,
  tags,
  replyTo,
  apiKey = process.env.BREVO_API_KEY
}) {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      error: "BREVO_API_KEY is not configured. Please set the BREVO_API_KEY server environment variable.",
      code: "MISSING_API_KEY"
    };
  }

  // Sender validation
  if (!sender || !sender.email || !isValidEmail(sender.email)) {
    return {
      success: false,
      error: "A valid sender email address is required.",
      code: "INVALID_SENDER"
    };
  }

  // Subject validation
  if (!subject || typeof subject !== "string" || !subject.trim()) {
    return {
      success: false,
      error: "Subject line is required.",
      code: "INVALID_SUBJECT"
    };
  }

  // Content validation
  if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
    return {
      success: false,
      error: "HTML email content cannot be empty.",
      code: "INVALID_CONTENT"
    };
  }

  // Normalize recipient(s)
  let recipients = [];
  if (Array.isArray(to)) {
    recipients = to.map(r => (typeof r === "string" ? { email: r } : r));
  } else if (typeof to === "string") {
    recipients = [{ email: to }];
  } else if (to && typeof to === "object" && to.email) {
    recipients = [to];
  }

  if (recipients.length === 0 || !recipients.every(r => r && isValidEmail(r.email))) {
    return {
      success: false,
      error: "At least one valid recipient email address is required.",
      code: "INVALID_RECIPIENT"
    };
  }

  // Prepare Brevo API payload
  const payload = {
    sender: {
      email: sender.email.trim(),
      ...(sender.name && sender.name.trim() ? { name: sender.name.trim() } : {})
    },
    to: recipients.map(r => ({
      email: r.email.trim(),
      ...(r.name && r.name.trim() ? { name: r.name.trim() } : {})
    })),
    subject: subject.trim(),
    htmlContent
  };

  if (textContent && typeof textContent === "string" && textContent.trim()) {
    payload.textContent = textContent.trim();
  }

  if (headers && typeof headers === "object" && Object.keys(headers).length > 0) {
    payload.headers = headers;
  }

  if (Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags.map(t => String(t).trim()).filter(Boolean);
  }

  if (replyTo && replyTo.email && isValidEmail(replyTo.email)) {
    payload.replyTo = {
      email: replyTo.email.trim(),
      ...(replyTo.name && replyTo.name.trim() ? { name: replyTo.name.trim() } : {})
    };
  }

  try {
    const signal = AbortSignal.timeout(15000); // 15 second timeout per transactional send
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": apiKey.trim()
      },
      body: JSON.stringify(payload),
      signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Safe error parsing without exposing sensitive payload details
      const providerMsg = data.message || data.error || `Brevo API HTTP ${response.status}`;
      return {
        success: false,
        error: providerMsg,
        code: response.status === 429 ? "HTTP_429" : (data.code || `HTTP_${response.status}`),
        status: response.status
      };
    }

    // Success response contains messageId: string
    return {
      success: true,
      messageId: data.messageId || null,
      status: response.status
    };
  } catch (err) {
    // Network or fetch abort error
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError" || /timeout/i.test(err.message || "");
    return {
      success: false,
      error: isTimeout ? "Network timeout waiting for email delivery service." : "Failed to connect to email delivery service.",
      code: isTimeout ? "NETWORK_TIMEOUT" : "NETWORK_ERROR"
    };
  }
}
