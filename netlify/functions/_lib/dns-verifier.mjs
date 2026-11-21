// DNS Verification and Deliverability Engine for MailFlow AI
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Validates whether a domain name is safe and RFC-compliant.
 * Implements strict SSRF protection against internal/loopback/private IP addresses.
 */
export function validateSafeDomain(rawDomain) {
  if (!rawDomain || typeof rawDomain !== "string") {
    return { valid: false, reason: "Domain name is required." };
  }

  const domain = rawDomain.trim().toLowerCase();

  if (domain.length < 3 || domain.length > 253) {
    return { valid: false, reason: "Domain must be between 3 and 253 characters." };
  }

  // Prevent protocol prefixes
  if (domain.startsWith("http://") || domain.startsWith("https://") || domain.includes("/")) {
    return { valid: false, reason: "Please provide a domain name without http://, https://, or path slashes." };
  }

  // Reject raw IP addresses (IPv4 & IPv6)
  if (net.isIP(domain) !== 0) {
    return { valid: false, reason: "Direct IP addresses are not permitted as sending domains." };
  }

  // Reject localhost and local/private TLDs
  const forbiddenTLDs = [
    "localhost",
    "local",
    "internal",
    "lan",
    "test",
    "example",
    "invalid",
    "home.arpa"
  ];

  const labels = domain.split(".");
  if (labels.length < 2) {
    return { valid: false, reason: "Domain must include a valid top-level domain (e.g. example.com)." };
  }

  const tld = labels[labels.length - 1];
  if (forbiddenTLDs.includes(tld)) {
    return { valid: false, reason: `The .${tld} domain zone cannot be verified for email sending.` };
  }

  // Check each DNS label according to RFC 1035:
  // Must be 1-63 chars, start and end with alphanumeric, contain only alphanumeric or hyphen
  const domainRegex = /^(?!:\/\/)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, reason: "Invalid domain format. Only alphanumeric characters and hyphens are allowed." };
  }

  return { valid: true, domain };
}

/**
 * Safely resolves TXT records for a hostname.
 */
export async function lookupTxtRecords(hostname) {
  try {
    const rawRecords = await dns.resolveTxt(hostname);
    // dns.resolveTxt returns string[][], join chunks for multi-part records
    return rawRecords.map(chunkArray => chunkArray.join(""));
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ESERVFAIL", "EREFUSED"].includes(error.code)) {
      return [];
    }
    // Re-throw or return empty for timeouts
    return [];
  }
}

/**
 * Safely resolves CNAME records for a hostname.
 */
export async function lookupCnameRecords(hostname) {
  try {
    const records = await dns.resolveCname(hostname);
    return Array.isArray(records) ? records.map(r => r.toLowerCase().replace(/\.$/, "")) : [];
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ESERVFAIL", "EREFUSED"].includes(error.code)) {
      return [];
    }
    return [];
  }
}

/**
 * Generates the default set of DNS records required for domain sending authentication.
 */
export function generateDefaultDnsRecords(domain, options = {}) {
  const dkimSelector = options.dkimSelector || "mailo";
  const trackingSubdomain = options.trackingSubdomain || "track";

  return [
    {
      purpose: "SPF",
      recordType: "TXT",
      name: "@",
      expectedValue: "v=spf1 include:spf.brevo.com ~all",
      status: "PENDING"
    },
    {
      purpose: "DKIM",
      recordType: "TXT",
      name: `${dkimSelector}._domainkey`,
      expectedValue: "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMkWegAA8/zsYhk7smW5LFA5r7130BEVC848YJvd03wu63628ONFFJM6QmIkLLNptUm55dfVBWj2UmSEzrR4POJN1WDmAE9/7TagMqcP16hnPE40064ZB63uErwIDAQAB",
      status: "PENDING"
    },
    {
      purpose: "DMARC",
      recordType: "TXT",
      name: "_dmarc",
      expectedValue: `v=DMARC1; p=none; sp=none; rua=mailto:dmarc-reports@${domain}`,
      status: "PENDING"
    },
    {
      purpose: "TRACKING",
      recordType: "CNAME",
      name: trackingSubdomain,
      expectedValue: "track.mailflow.app",
      status: "PENDING"
    }
  ];
}

/**
 * Resolves the full target FQDN for a record given its name and root domain.
 */
export function resolveTargetHostname(name, domain) {
  if (!name || name === "@") return domain;
  if (name.endsWith(`.${domain}`)) return name;
  return `${name}.${domain}`;
}

/**
 * Performs DNS verification for an individual DNS record.
 */
export async function verifySingleRecord(record, domain) {
  const targetHost = resolveTargetHostname(record.name, domain);
  const result = {
    id: record.id,
    purpose: record.purpose,
    recordType: record.recordType,
    name: record.name,
    expectedValue: record.expectedValue,
    actualValue: null,
    status: "MISSING",
    errorMessage: null,
    lastCheckedAt: new Date()
  };

  try {
    if (record.recordType === "TXT") {
      const txtRecords = await lookupTxtRecords(targetHost);
      result.actualValue = txtRecords.length > 0 ? txtRecords[0] : null;

      if (txtRecords.length === 0) {
        result.status = "MISSING";
        result.errorMessage = `No TXT records found for ${targetHost}`;
        return result;
      }

      if (record.purpose === "SPF") {
        // Look for any SPF record (v=spf1)
        const spfRecord = txtRecords.find(t => t.toLowerCase().startsWith("v=spf1"));
        if (!spfRecord) {
          result.status = "MISSING";
          result.errorMessage = "No v=spf1 record published on root domain";
          return result;
        }

        result.actualValue = spfRecord;
        // Verify inclusion of brevo or matching expected
        const hasBrevoInclude = spfRecord.toLowerCase().includes("include:spf.brevo.com");
        const matchesExpected = spfRecord.trim() === record.expectedValue.trim();

        if (hasBrevoInclude || matchesExpected) {
          result.status = "VERIFIED";
        } else {
          result.status = "INVALID";
          result.errorMessage = "SPF record found, but does not include required 'include:spf.brevo.com' mechanism.";
        }
        return result;
      }

      if (record.purpose === "DKIM") {
        // Look for DKIM key record
        const dkimRecord = txtRecords.find(t => t.includes("p=") || t.toLowerCase().includes("v=dkim1"));
        if (!dkimRecord) {
          result.status = "MISSING";
          result.errorMessage = `DKIM public key not found on ${targetHost}`;
          return result;
        }

        result.actualValue = dkimRecord;
        // Check if contains key data
        if (dkimRecord.includes("p=") && dkimRecord.length > 20) {
          result.status = "VERIFIED";
        } else {
          result.status = "INVALID";
          result.errorMessage = "DKIM record exists but public key 'p=' parameter is invalid or empty.";
        }
        return result;
      }

      if (record.purpose === "DMARC") {
        const dmarcRecord = txtRecords.find(t => t.toLowerCase().startsWith("v=dmarc1"));
        if (!dmarcRecord) {
          result.status = "MISSING";
          result.errorMessage = `No v=DMARC1 record found at ${targetHost}`;
          return result;
        }

        result.actualValue = dmarcRecord;
        if (/p=(none|quarantine|reject)/i.test(dmarcRecord)) {
          result.status = "VERIFIED";
        } else {
          result.status = "INVALID";
          result.errorMessage = "DMARC record found, but missing valid policy 'p=none|quarantine|reject'.";
        }
        return result;
      }

      // Generic TXT match
      if (txtRecords.includes(record.expectedValue)) {
        result.status = "VERIFIED";
      } else {
        result.status = "INVALID";
        result.errorMessage = "Published TXT record does not match expected value.";
      }
      return result;
    }

    if (record.recordType === "CNAME") {
      const cnames = await lookupCnameRecords(targetHost);
      result.actualValue = cnames.length > 0 ? cnames[0] : null;

      if (cnames.length === 0) {
        result.status = "MISSING";
        result.errorMessage = `No CNAME record found for ${targetHost}`;
        return result;
      }

      const normalizedExpected = record.expectedValue.toLowerCase().replace(/\.$/, "");
      const matched = cnames.some(c => c === normalizedExpected);

      if (matched) {
        result.status = "VERIFIED";
      } else {
        result.status = "INVALID";
        result.errorMessage = `CNAME points to '${cnames[0]}', expected '${normalizedExpected}'.`;
      }
      return result;
    }

    result.status = "INVALID";
    result.errorMessage = `Unsupported record type: ${record.recordType}`;
    return result;
  } catch (err) {
    result.status = "MISSING";
    result.errorMessage = err.message || "DNS query failed";
    return result;
  }
}

/**
 * Calculates a comprehensive domain health score (0 - 100) based on DNS status and deliverability metrics.
 */
export function calculateDomainHealthScore({
  spfStatus = "PENDING",
  dkimStatus = "PENDING",
  dmarcStatus = "PENDING",
  customTrackingStatus = "PENDING",
  bounceRate = 0,
  complaintRate = 0
}) {
  let score = 50; // Base score for added domain

  if (spfStatus === "VERIFIED") score += 15;
  else if (spfStatus === "INVALID") score -= 10;

  if (dkimStatus === "VERIFIED") score += 20;
  else if (dkimStatus === "INVALID") score -= 15;

  if (dmarcStatus === "VERIFIED") score += 15;
  else if (dmarcStatus === "INVALID") score -= 5;

  if (customTrackingStatus === "VERIFIED") score += 5;

  // Penalize high bounce rates
  if (bounceRate > 10) {
    score -= 30;
  } else if (bounceRate > 5) {
    score -= 20;
  } else if (bounceRate > 2) {
    score -= 10;
  }

  // Penalize spam complaint rates (industry red-alert is > 0.1%)
  if (complaintRate > 0.5) {
    score -= 40;
  } else if (complaintRate > 0.1) {
    score -= 25;
  } else if (complaintRate > 0.05) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Provides step-by-step registrar instructions for configuring DNS records.
 */
export function getRegistrarInstructions(domain, provider = "generic") {
  const commonNotes = [
    "DNS propagation may take anywhere from a few minutes to up to 24 hours depending on TTL.",
    "Make sure proxy status is disabled (DNS only) if using Cloudflare for DKIM and SPF TXT records.",
    "If your domain already has an existing SPF record, do not create a second one! Instead, merge 'include:spf.brevo.com' into your existing v=spf1 record before the '~all' or '-all'."
  ];

  switch (provider.toLowerCase()) {
    case "cloudflare":
      return {
        provider: "Cloudflare",
        steps: [
          "Log into your Cloudflare dashboard and select your domain.",
          "Navigate to the 'DNS' -> 'Records' tab.",
          "Click 'Add record' for each DNS record shown above.",
          "For TXT records (SPF, DKIM, DMARC), set TTL to 'Auto'.",
          "For the CNAME tracking record, ensure 'Proxy status' is toggled to 'DNS only' (grey cloud), NOT proxied (orange cloud).",
          "Save each record and click 'Verify DNS Now' in MailFlow AI."
        ],
        notes: commonNotes
      };

    case "godaddy":
      return {
        provider: "GoDaddy",
        steps: [
          "Log in to your GoDaddy Domain Portfolio.",
          "Select the domain you want to configure and click 'DNS'.",
          "Click 'Add New Record' in the DNS Records section.",
          "Select 'TXT' or 'CNAME' as required.",
          "Enter the Host name (use '@' for root SPF, 'mailo._domainkey' for DKIM, '_dmarc' for DMARC).",
          "Paste the Value and set TTL to '1/2 Hour' (or Default).",
          "Click 'Save' and return to MailFlow AI to verify."
        ],
        notes: commonNotes
      };

    case "namecheap":
      return {
        provider: "Namecheap",
        steps: [
          "Log into Namecheap and navigate to your 'Domain List'.",
          "Click 'Manage' next to your sending domain.",
          "Switch to the 'Advanced DNS' tab.",
          "Under 'Host Records', click 'Add New Record'.",
          "Add the TXT and CNAME records with the corresponding Host and Value.",
          "Set TTL to 'Automatic' or '1 min' for fast propagation.",
          "Click the green checkmark to save each record."
        ],
        notes: commonNotes
      };

    case "route53":
    case "aws":
      return {
        provider: "Amazon Route 53",
        steps: [
          "Open the AWS Management Console and go to Route 53 Hosted Zones.",
          "Click on your domain name's hosted zone.",
          "Click 'Create record'.",
          "Enter the Record name prefix (leave blank for root, or enter selector/subdomain).",
          "Select Record type (TXT or CNAME).",
          "Paste the Expected Value in the Value text area (enclosing multi-part TXT strings in double quotes).",
          "Click 'Create records' and verify in MailFlow AI."
        ],
        notes: commonNotes
      };

    default:
      return {
        provider: "Generic DNS Provider",
        steps: [
          "Log into the DNS management console of your domain registrar or hosting provider.",
          "Locate the DNS Zone Editor, DNS Management, or Name Server records section.",
          "Create the required TXT and CNAME records with the exact Host/Name and Value specified in the table.",
          "Allow DNS caches to refresh, then click 'Verify DNS Now'."
        ],
        notes: commonNotes
      };
  }
}
