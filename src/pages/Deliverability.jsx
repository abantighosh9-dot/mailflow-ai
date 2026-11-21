import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Search,
  Sparkles,
  Info,
  Server,
  FileText,
  Mail,
  ChevronRight,
  X
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";

const CLEAN_EMAIL_SAMPLE = {
  subject: "Your monthly newsletter and product updates",
  fromEmail: "updates@mycompany.com",
  html: `<div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #333;">
  <h2>Hello {{firstName}},</h2>
  <p>Thank you for being a valued member of our community. Here are the top highlights and feature updates from this month.</p>
  <ul>
    <li>New automated drip workflow builder</li>
    <li>Enhanced deliverability analytics</li>
    <li>Improved template customization</li>
  </ul>
  <p>Have questions or feedback? Reply directly to this email or visit our help center.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
  <p style="font-size: 12px; color: #888;">
    Acme Corp, 123 Innovation Way, Suite 400, San Francisco, CA 94107<br />
    You received this email because you subscribed to product updates.
    <a href="{{unsubscribe_url}}" style="color: #6366f1;">Unsubscribe</a> from these emails.
  </p>
</div>`
};

const RISKY_EMAIL_SAMPLE = {
  subject: "CONGRATULATIONS! 100% FREE CASH BONUS ACT NOW!!!!",
  fromEmail: "winner77@gmail.com",
  html: `<div>
  <h1>YOU HAVE BEEN SELECTED AS OUR LUCKY WINNER!</h1>
  <p>Claim your 100% free cash bonus and fast cash prize now! No catch, no risk, no obligation!</p>
  <p><a href="http://bit.ly/claim-prize-now">CLICK HERE TO GET PAID IMMEDIATELY!!!</a></p>
  <img src="https://via.placeholder.com/600x400.png?text=WINNER" alt="winner" />
</div>`
};

export default function Deliverability() {
  const { user, workspace } = useAuth();
  const role = workspace?.role || user?.role || "VIEWER";
  const writable = ["OWNER", "ADMIN", "EDITOR"].includes(role);
  const canDelete = ["OWNER", "ADMIN"].includes(role);

  // Overview state
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // Domains list state
  const [domains, setDomains] = useState([]);
  const [loadingDomains, setLoadingDomains] = useState(true);

  // Add Domain Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newDkimSelector, setNewDkimSelector] = useState("mailo");
  const [newTrackingSubdomain, setNewTrackingSubdomain] = useState("track");
  const [addingDomain, setAddingDomain] = useState(false);
  const [addError, setAddError] = useState("");

  // Inspect DNS Records Modal
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [activeProviderTab, setActiveProviderTab] = useState("cloudflare");
  const [verifyingId, setVerifyingId] = useState(null);
  const [copiedRecordId, setCopiedRecordId] = useState(null);

  // Spam Analyzer State
  const [spamSubject, setSpamSubject] = useState(CLEAN_EMAIL_SAMPLE.subject);
  const [spamFromEmail, setSpamFromEmail] = useState(CLEAN_EMAIL_SAMPLE.fromEmail);
  const [spamHtml, setSpamHtml] = useState(CLEAN_EMAIL_SAMPLE.html);
  const [analyzingSpam, setAnalyzingSpam] = useState(false);
  const [spamAnalysis, setSpamAnalysis] = useState(null);
  const [spamError, setSpamError] = useState("");

  // General alert/notification banner
  const [notification, setNotification] = useState(null);

  const showNotification = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  // Fetch overview
  const fetchOverview = useCallback(async () => {
    try {
      setLoadingOverview(true);
      const data = await api("/deliverability/overview");
      setOverview(data);
    } catch (err) {
      console.error("Failed to load deliverability overview:", err);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Fetch domains
  const fetchDomains = useCallback(async () => {
    try {
      setLoadingDomains(true);
      const data = await api("/deliverability/domains");
      setDomains(data.domains || []);
    } catch (err) {
      console.error("Failed to load sending domains:", err);
    } finally {
      setLoadingDomains(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    fetchDomains();
  }, [fetchOverview, fetchDomains]);

  // Handle Add Domain
  const handleAddDomain = async e => {
    e.preventDefault();
    setAddError("");
    if (!newDomain.trim()) {
      setAddError("Domain name is required.");
      return;
    }

    try {
      setAddingDomain(true);
      const data = await api("/deliverability/domains", {
        method: "POST",
        body: JSON.stringify({
          domain: newDomain.trim(),
          dkimSelector: newDkimSelector.trim() || "mailo",
          trackingSubdomain: newTrackingSubdomain.trim() || "track"
        })
      });

      showNotification(`Domain ${data.domain.domain} added successfully.`);
      setNewDomain("");
      setShowAddModal(false);
      await fetchDomains();
      await fetchOverview();
      // Directly open instructions for the newly added domain
      setSelectedDomain(data.domain);
    } catch (err) {
      setAddError(err.message || "Failed to add domain.");
    } finally {
      setAddingDomain(false);
    }
  };

  // Handle Verify Domain DNS
  const handleVerifyDomain = async domainId => {
    try {
      setVerifyingId(domainId);
      const data = await api(`/deliverability/domains/${domainId}/verify`, {
        method: "POST"
      });

      showNotification(data.message || "DNS verification complete.");
      await fetchDomains();
      await fetchOverview();

      // If inspect modal is open for this domain, update it
      if (selectedDomain && selectedDomain.id === domainId) {
        setSelectedDomain(data.domain);
      }
    } catch (err) {
      showNotification(err.message || "Failed to verify DNS records.", "error");
    } finally {
      setVerifyingId(null);
    }
  };

  // Handle Delete Domain
  const handleDeleteDomain = async (domainId, domainName) => {
    if (!window.confirm(`Are you sure you want to delete sending domain "${domainName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await api(`/deliverability/domains/${domainId}`, {
        method: "DELETE"
      });
      showNotification(`Domain ${domainName} deleted.`);
      if (selectedDomain?.id === domainId) {
        setSelectedDomain(null);
      }
      await fetchDomains();
      await fetchOverview();
    } catch (err) {
      showNotification(err.message || "Failed to delete domain.", "error");
    }
  };

  // Handle Copy to Clipboard
  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedRecordId(key);
    setTimeout(() => setCopiedRecordId(null), 2000);
  };

  // Handle Spam Score Analysis
  const handleAnalyzeSpam = async () => {
    setSpamError("");
    try {
      setAnalyzingSpam(true);
      const result = await api("/deliverability/analyze-spam", {
        method: "POST",
        body: JSON.stringify({
          subject: spamSubject,
          fromEmail: spamFromEmail,
          html: spamHtml
        })
      });
      setSpamAnalysis(result);
    } catch (err) {
      setSpamError(err.message || "Failed to analyze email content.");
    } finally {
      setAnalyzingSpam(false);
    }
  };

  const getStatusBadge = status => {
    switch (status) {
      case "VERIFIED":
        return <span className="status-badge status-verified"><CheckCircle2 size={13}/> Verified</span>;
      case "FAILED":
      case "INVALID":
        return <span className="status-badge status-failed"><ShieldX size={13}/> Failed</span>;
      default:
        return <span className="status-badge status-pending"><RefreshCw size={13} className="spin-slow"/> Pending DNS</span>;
    }
  };

  const getScoreColor = score => {
    if (score >= 80) return "#10b981"; // Emerald
    if (score >= 60) return "#f59e0b"; // Amber
    return "#ef4444"; // Rose
  };

  return (
    <div className="page-container deliverability-page">
      {/* Page Header */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title flex-align gap-2">
            <ShieldCheck size={28} className="text-primary"/> Email Deliverability & DNS Authentication
          </h1>
          <p className="page-subtitle">
            Authenticate your custom sending domains with SPF, DKIM, and DMARC to guarantee high inbox placement.
          </p>
        </div>
        {writable && (
          <button
            className="btn btn-primary flex-align gap-2"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16}/> Add Sending Domain
          </button>
        )}
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className={`notification-banner ${notification.type === "error" ? "banner-error" : "banner-success"}`}>
          {notification.type === "error" ? <AlertCircle size={18}/> : <CheckCircle2 size={18}/>}
          <span>{notification.msg}</span>
          <button className="btn-icon-close" onClick={() => setNotification(null)}><X size={14}/></button>
        </div>
      )}

      {/* Deliverability Warnings Alert */}
      {overview?.alerts?.highBounceRate && (
        <div className="deliverability-alert alert-critical">
          <ShieldAlert size={20}/>
          <div>
            <strong>High Bounce Rate Warning ({overview.metrics.bounceRate}%):</strong> Your bounce rate exceeds the safe 5% threshold. High bounces trigger ISP blacklists and throttling. Clean your contact list immediately.
          </div>
        </div>
      )}

      {overview?.alerts?.highComplaintRate && (
        <div className="deliverability-alert alert-critical">
          <ShieldAlert size={20}/>
          <div>
            <strong>High Spam Complaint Alert ({overview.metrics.complaintRate}%):</strong> Your complaint rate is above 0.1%. Major email providers (Gmail, Yahoo) require complaint rates under 0.10% to prevent domain suspension.
          </div>
        </div>
      )}

      {overview?.alerts?.noVerifiedDomain && (
        <div className="deliverability-alert alert-warning">
          <AlertTriangle size={20}/>
          <div>
            <strong>No Verified Sending Domains:</strong> Emails sent without SPF and DKIM authentication are frequently sent to the spam folder. Add and authenticate your domain below.
          </div>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="deliverability-grid">
        {/* Health Score Card */}
        <div className="deliverability-card health-score-card">
          <div className="card-header">
            <h3>Overall Domain Health</h3>
            <span className={`health-pill health-${(overview?.status || "GOOD").toLowerCase()}`}>
              {overview?.status || "HEALTHY"}
            </span>
          </div>
          <div className="score-gauge-container">
            <div
              className="radial-gauge"
              style={{
                background: `conic-gradient(${getScoreColor(overview?.healthScore ?? 50)} ${(overview?.healthScore ?? 50) * 3.6}deg, #e2e8f0 0deg)`
              }}
            >
              <div className="radial-gauge-inner">
                <span className="gauge-number">{overview?.healthScore ?? "--"}</span>
                <span className="gauge-label">out of 100</span>
              </div>
            </div>
            <p className="score-desc">
              {overview?.healthScore >= 80
                ? "Your workspace domain authentication is optimal. Inboxes trust your sender signature."
                : overview?.healthScore >= 60
                ? "Acceptable deliverability, but completing SPF and DMARC records will boost inbox placement."
                : "Action required: Complete DNS authentication to prevent emails going to junk."}
            </p>
          </div>
        </div>

        {/* Rate Metrics Card */}
        <div className="deliverability-card rate-metrics-card">
          <div className="card-header">
            <h3>Reputation & Delivery Rates</h3>
            <button className="btn-icon" onClick={fetchOverview} title="Refresh metrics">
              <RefreshCw size={15} className={loadingOverview ? "spin" : ""}/>
            </button>
          </div>
          <div className="rates-grid">
            <div className="rate-box">
              <div className="rate-title">Delivery Rate</div>
              <div className="rate-value text-success">{overview?.metrics?.deliveryRate ?? 100}%</div>
              <div className="rate-hint">{overview?.metrics?.totalDelivered ?? 0} delivered</div>
            </div>

            <div className="rate-box">
              <div className="rate-title">Bounce Rate</div>
              <div className={`rate-value ${(overview?.metrics?.bounceRate ?? 0) > 5 ? "text-danger" : "text-neutral"}`}>
                {overview?.metrics?.bounceRate ?? 0}%
              </div>
              <div className="rate-hint">{overview?.metrics?.totalBounced ?? 0} bounced (target &lt; 2%)</div>
            </div>

            <div className="rate-box">
              <div className="rate-title">Complaint Rate</div>
              <div className={`rate-value ${(overview?.metrics?.complaintRate ?? 0) > 0.1 ? "text-danger" : "text-neutral"}`}>
                {overview?.metrics?.complaintRate ?? 0}%
              </div>
              <div className="rate-hint">{overview?.metrics?.totalComplained ?? 0} spam reports (target &lt; 0.1%)</div>
            </div>

            <div className="rate-box">
              <div className="rate-title">Open Rate</div>
              <div className="rate-value text-primary">{overview?.metrics?.openRate ?? 0}%</div>
              <div className="rate-hint">{overview?.metrics?.totalOpened ?? 0} opened</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sending Domains List Section */}
      <div className="content-section">
        <div className="section-header flex-between">
          <div>
            <h2 className="section-title flex-align gap-2">
              <Server size={20}/> Sending Domains ({domains.length})
            </h2>
            <p className="section-subtitle">
              Configure DNS records with your registrar to establish sender authenticity.
            </p>
          </div>
          {writable && (
            <button
              className="btn btn-outline flex-align gap-1"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={15}/> Add Domain
            </button>
          )}
        </div>

        {loadingDomains ? (
          <div className="loading-state">
            <RefreshCw size={24} className="spin text-primary"/>
            <p>Loading sending domains...</p>
          </div>
        ) : domains.length === 0 ? (
          <div className="empty-state-box">
            <ShieldAlert size={48} className="text-muted"/>
            <h3>No sending domains configured</h3>
            <p>Add your company's domain to authenticate sending via SPF, DKIM, and DMARC.</p>
            {writable && (
              <button
                className="btn btn-primary mt-3 flex-align gap-2"
                onClick={() => setShowAddModal(true)}
              >
                <Plus size={16}/> Connect Your First Domain
              </button>
            )}
          </div>
        ) : (
          <div className="domains-table-container">
            <table className="table domains-table">
              <thead>
                <tr>
                  <th>Domain Name</th>
                  <th>Overall Status</th>
                  <th>SPF</th>
                  <th>DKIM</th>
                  <th>DMARC</th>
                  <th>Tracking</th>
                  <th>Health</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {domains.map(d => (
                  <tr key={d.id}>
                    <td>
                      <div className="domain-name-cell">
                        <strong>{d.domain}</strong>
                        <span className="domain-subtext">
                          Last checked: {d.lastVerifiedAt ? new Date(d.lastVerifiedAt).toLocaleDateString() : "Never"}
                        </span>
                      </div>
                    </td>
                    <td>{getStatusBadge(d.status)}</td>
                    <td>
                      <span className={`proto-pill proto-${d.spfStatus.toLowerCase()}`}>
                        SPF: {d.spfStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`proto-pill proto-${d.dkimStatus.toLowerCase()}`}>
                        DKIM: {d.dkimStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`proto-pill proto-${d.dmarcStatus.toLowerCase()}`}>
                        DMARC: {d.dmarcStatus}
                      </span>
                    </td>
                    <td>
                      <span className={`proto-pill proto-${d.customTrackingStatus.toLowerCase()}`}>
                        CNAME: {d.customTrackingStatus}
                      </span>
                    </td>
                    <td>
                      <div className="health-score-cell">
                        <span
                          className="health-badge"
                          style={{ backgroundColor: getScoreColor(d.healthScore) }}
                        >
                          {d.healthScore}%
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="table-actions">
                        <button
                          className="btn btn-sm btn-outline flex-align gap-1"
                          onClick={() => handleVerifyDomain(d.id)}
                          disabled={verifyingId === d.id || !writable}
                          title="Verify DNS records now"
                        >
                          <RefreshCw size={13} className={verifyingId === d.id ? "spin" : ""}/>
                          {verifyingId === d.id ? "Checking..." : "Verify DNS"}
                        </button>

                        <button
                          className="btn btn-sm btn-secondary flex-align gap-1"
                          onClick={() => setSelectedDomain(d)}
                          title="View DNS records and registrar instructions"
                        >
                          <FileText size={13}/> Records
                        </button>

                        {canDelete && (
                          <button
                            className="btn btn-sm btn-danger-icon"
                            onClick={() => handleDeleteDomain(d.id, d.domain)}
                            title="Delete domain"
                          >
                            <Trash2 size={14}/>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pre-Send Email Spam Score Analyzer Tool */}
      <div className="content-section spam-analyzer-section">
        <div className="section-header flex-between">
          <div>
            <h2 className="section-title flex-align gap-2">
              <Sparkles size={20} className="text-primary"/> Pre-Send Spam Score & Deliverability Analyzer
            </h2>
            <p className="section-subtitle">
              Test your email content against major spam filtering rules before launching your campaign.
            </p>
          </div>
          <div className="sample-loaders flex-align gap-2">
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setSpamSubject(CLEAN_EMAIL_SAMPLE.subject);
                setSpamFromEmail(CLEAN_EMAIL_SAMPLE.fromEmail);
                setSpamHtml(CLEAN_EMAIL_SAMPLE.html);
              }}
            >
              Load Clean Sample
            </button>
            <button
              className="btn btn-sm btn-outline text-danger"
              onClick={() => {
                setSpamSubject(RISKY_EMAIL_SAMPLE.subject);
                setSpamFromEmail(RISKY_EMAIL_SAMPLE.fromEmail);
                setSpamHtml(RISKY_EMAIL_SAMPLE.html);
              }}
            >
              Load Risky Sample
            </button>
          </div>
        </div>

        <div className="spam-analyzer-layout">
          {/* Left: Input Form */}
          <div className="analyzer-form-col">
            <div className="form-group mb-3">
              <label className="form-label">Email Subject Line</label>
              <input
                type="text"
                className="form-control"
                value={spamSubject}
                onChange={e => setSpamSubject(e.target.value)}
                placeholder="e.g. Special invitation to our exclusive masterclass"
              />
              <span className="form-hint">{spamSubject.length} characters (ideal: 30 - 60)</span>
            </div>

            <div className="form-group mb-3">
              <label className="form-label">From Email Address</label>
              <input
                type="email"
                className="form-control"
                value={spamFromEmail}
                onChange={e => setSpamFromEmail(e.target.value)}
                placeholder="e.g. sender@yourbrand.com"
              />
            </div>

            <div className="form-group mb-3">
              <label className="form-label">Email Body (HTML or Plain Text)</label>
              <textarea
                className="form-control font-mono"
                rows={9}
                value={spamHtml}
                onChange={e => setSpamHtml(e.target.value)}
                placeholder="Paste your email HTML content here..."
              />
            </div>

            {spamError && <div className="text-danger mb-2 text-sm">{spamError}</div>}

            <button
              className="btn btn-primary flex-align gap-2"
              onClick={handleAnalyzeSpam}
              disabled={analyzingSpam}
            >
              <Sparkles size={16}/>
              {analyzingSpam ? "Analyzing Content..." : "Analyze Spam Risk"}
            </button>
          </div>

          {/* Right: Analysis Results Panel */}
          <div className="analyzer-results-col">
            {spamAnalysis ? (
              <div className="analysis-card">
                <div className="analysis-header flex-between">
                  <div className="flex-align gap-2">
                    <span
                      className="analysis-score-badge"
                      style={{ backgroundColor: getScoreColor(spamAnalysis.score) }}
                    >
                      {spamAnalysis.score}
                    </span>
                    <div>
                      <h4 className="mb-0">Spam Safety Score</h4>
                      <span className={`risk-tag risk-${spamAnalysis.riskLevel.toLowerCase()}`}>
                        {spamAnalysis.riskLevel} RISK
                      </span>
                    </div>
                  </div>
                </div>

                <p className="analysis-summary mt-2">{spamAnalysis.summary}</p>

                {/* Issues List */}
                <div className="analysis-block mt-3">
                  <h5 className="block-title">Detected Issues ({spamAnalysis.issues.length})</h5>
                  {spamAnalysis.issues.length === 0 ? (
                    <div className="clean-tag flex-align gap-1">
                      <CheckCircle2 size={16} className="text-success"/> No spam triggers or compliance violations found!
                    </div>
                  ) : (
                    <ul className="issues-list">
                      {spamAnalysis.issues.map((issue, idx) => (
                        <li key={idx} className={`issue-item severity-${issue.severity.toLowerCase()}`}>
                          <span className="severity-badge">{issue.severity}</span>
                          <span className="issue-text">{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Suggestions List */}
                {spamAnalysis.suggestions.length > 0 && (
                  <div className="analysis-block mt-3">
                    <h5 className="block-title">Deliverability Recommendations</h5>
                    <ul className="suggestions-list">
                      {spamAnalysis.suggestions.map((sug, idx) => (
                        <li key={idx} className="suggestion-item">
                          <Check size={14} className="text-primary"/>
                          <span>{sug}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="analysis-placeholder">
                <Search size={36} className="text-muted mb-2"/>
                <h4>Run a Content Check</h4>
                <p>Click "Analyze Spam Risk" to inspect compliance tags, trigger keywords, and domain reputations.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Domain Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header flex-between">
              <h3>Connect New Sending Domain</h3>
              <button className="btn-icon-close" onClick={() => setShowAddModal(false)}>
                <X size={18}/>
              </button>
            </div>
            <form onSubmit={handleAddDomain}>
              <div className="modal-body">
                <p className="modal-desc">
                  Enter your business sending domain (e.g. <code>mybrand.com</code> or <code>mail.mybrand.com</code>).
                  We will generate the required SPF, DKIM, and DMARC DNS records for your registrar.
                </p>

                {addError && <div className="alert alert-danger mb-3">{addError}</div>}

                <div className="form-group mb-3">
                  <label className="form-label">Sending Domain Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. yourcompany.com"
                    value={newDomain}
                    onChange={e => setNewDomain(e.target.value)}
                    required
                  />
                  <span className="form-hint">Do not include "https://" or path slashes.</span>
                </div>

                <div className="form-row">
                  <div className="form-group mb-3 flex-1">
                    <label className="form-label">DKIM Selector</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newDkimSelector}
                      onChange={e => setNewDkimSelector(e.target.value)}
                    />
                    <span className="form-hint">Default: mailo</span>
                  </div>

                  <div className="form-group mb-3 flex-1">
                    <label className="form-label">Tracking Subdomain</label>
                    <input
                      type="text"
                      className="form-control"
                      value={newTrackingSubdomain}
                      onChange={e => setNewTrackingSubdomain(e.target.value)}
                    />
                    <span className="form-hint">Default: track</span>
                  </div>
                </div>
              </div>
              <div className="modal-footer flex-between">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addingDomain}
                >
                  {addingDomain ? "Generating Records..." : "Generate DNS Records"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Records & Registrar Instructions Modal */}
      {selectedDomain && (
        <div className="modal-overlay" onClick={() => setSelectedDomain(null)}>
          <div className="modal-content modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header flex-between">
              <div>
                <h3>DNS Authentication Records: {selectedDomain.domain}</h3>
                <span className="modal-subtitle">
                  Publish these records in your DNS zone to complete domain verification.
                </span>
              </div>
              <button className="btn-icon-close" onClick={() => setSelectedDomain(null)}>
                <X size={18}/>
              </button>
            </div>

            <div className="modal-body">
              {/* DNS Records Table */}
              <div className="dns-records-table-container mb-4">
                <table className="table dns-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Host / Name</th>
                      <th>Expected Value</th>
                      <th>Status</th>
                      <th>Copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedDomain.dnsRecords || []).map(rec => (
                      <tr key={rec.id || rec.purpose}>
                        <td>
                          <span className="record-type-pill">{rec.recordType}</span>
                          <span className="record-purpose-text">{rec.purpose}</span>
                        </td>
                        <td>
                          <div className="flex-align gap-1">
                            <code className="dns-code">{rec.name}</code>
                            <button
                              className="btn-copy-small"
                              onClick={() => handleCopy(rec.name, `name-${rec.id}`)}
                              title="Copy Host"
                            >
                              {copiedRecordId === `name-${rec.id}` ? <Check size={12} className="text-success"/> : <Copy size={12}/>}
                            </button>
                          </div>
                        </td>
                        <td className="value-col">
                          <div className="dns-value-wrap">
                            <code className="dns-code-long">{rec.expectedValue}</code>
                            <button
                              className="btn-copy-small"
                              onClick={() => handleCopy(rec.expectedValue, `val-${rec.id}`)}
                              title="Copy Value"
                            >
                              {copiedRecordId === `val-${rec.id}` ? <Check size={12} className="text-success"/> : <Copy size={12}/>}
                            </button>
                          </div>
                          {rec.errorMessage && (
                            <div className="dns-error-text mt-1 text-danger">
                              {rec.errorMessage}
                            </div>
                          )}
                        </td>
                        <td>{getStatusBadge(rec.status)}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleCopy(rec.expectedValue, `all-${rec.id}`)}
                          >
                            {copiedRecordId === `all-${rec.id}` ? "Copied" : "Copy Value"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Step-by-Step Registrar Setup Guide */}
              <div className="registrar-guide-section">
                <h4 className="mb-2">Setup Guide by Provider</h4>
                <div className="provider-tabs flex-align gap-2 mb-3">
                  {["cloudflare", "godaddy", "namecheap", "route53", "generic"].map(prov => (
                    <button
                      key={prov}
                      className={`btn btn-sm ${activeProviderTab === prov ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setActiveProviderTab(prov)}
                    >
                      {prov === "route53" ? "AWS Route 53" : prov.charAt(0).toUpperCase() + prov.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="provider-instruction-box">
                  {activeProviderTab === "cloudflare" && (
                    <ol className="instruction-steps">
                      <li>Log into Cloudflare and click on <strong>{selectedDomain.domain}</strong>.</li>
                      <li>Navigate to <strong>DNS &gt; Records</strong> and click <strong>Add Record</strong>.</li>
                      <li>For SPF, DKIM, and DMARC: Select <strong>TXT</strong> and paste the corresponding Host and Value.</li>
                      <li>For the CNAME tracking record: Ensure <strong>Proxy status is toggled OFF (DNS Only)</strong>.</li>
                      <li>Click Save and return here to verify.</li>
                    </ol>
                  )}

                  {activeProviderTab === "godaddy" && (
                    <ol className="instruction-steps">
                      <li>Log in to GoDaddy and open your <strong>Domain Portfolio</strong>.</li>
                      <li>Select <strong>{selectedDomain.domain}</strong> and click <strong>DNS</strong>.</li>
                      <li>Click <strong>Add New Record</strong> and choose <strong>TXT</strong> or <strong>CNAME</strong>.</li>
                      <li>Set TTL to 1/2 hour or Default and paste the Host and Value.</li>
                      <li>Save and allow a few minutes for propagation.</li>
                    </ol>
                  )}

                  {activeProviderTab === "namecheap" && (
                    <ol className="instruction-steps">
                      <li>Go to your Namecheap <strong>Domain List</strong> and click <strong>Manage</strong>.</li>
                      <li>Open the <strong>Advanced DNS</strong> tab.</li>
                      <li>Under Host Records, click <strong>Add New Record</strong> for each row above.</li>
                      <li>Click the green checkmark to save each entry.</li>
                    </ol>
                  )}

                  {activeProviderTab === "route53" && (
                    <ol className="instruction-steps">
                      <li>Open the AWS Route 53 Console and choose your Hosted Zone.</li>
                      <li>Click <strong>Create record</strong>.</li>
                      <li>Enter Record name, select type (TXT or CNAME), and paste Value in quotes for TXT.</li>
                      <li>Click <strong>Create records</strong>.</li>
                    </ol>
                  )}

                  {activeProviderTab === "generic" && (
                    <ol className="instruction-steps">
                      <li>Log into your DNS provider or web host control panel.</li>
                      <li>Navigate to the DNS Zone Editor or DNS Management section.</li>
                      <li>Add the TXT and CNAME records with the exact hostnames and values listed above.</li>
                      <li>Save records and wait for DNS caches to update.</li>
                    </ol>
                  )}

                  <div className="provider-note mt-2">
                    <Info size={14} className="text-primary"/>
                    <span>
                      Note: If you already have an SPF record starting with <code>v=spf1</code>, do NOT create a second SPF record. Instead, edit your existing record to include <code>include:spf.brevo.com</code> before the <code>~all</code>.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer flex-between">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setSelectedDomain(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary flex-align gap-2"
                onClick={() => handleVerifyDomain(selectedDomain.id)}
                disabled={verifyingId === selectedDomain.id}
              >
                <RefreshCw size={15} className={verifyingId === selectedDomain.id ? "spin" : ""}/>
                {verifyingId === selectedDomain.id ? "Verifying DNS..." : "Verify DNS Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
