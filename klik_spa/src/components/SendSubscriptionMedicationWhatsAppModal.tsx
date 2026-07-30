"use client";

import { useCallback, useEffect, useState } from "react";
import { X, MessageCircle } from "lucide-react";
import {
  getSubscriptionMedicationWhatsAppPreview,
  sendSubscriptionMedicationReminder,
  type SubscriptionMedicationPlan,
  type SubscriptionMedicationWhatsAppPreview,
  type WhatsAppTemplateOption,
} from "../services/patientService";

interface SendSubscriptionMedicationWhatsAppModalProps {
  plan: SubscriptionMedicationPlan;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SendSubscriptionMedicationWhatsAppModal({
  plan,
  onClose,
  onSuccess,
}: SendSubscriptionMedicationWhatsAppModalProps) {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [countryHint, setCountryHint] = useState("");
  const [countryIsd, setCountryIsd] = useState("");
  const [templates, setTemplates] = useState<WhatsAppTemplateOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [preview, setPreview] = useState<SubscriptionMedicationWhatsAppPreview["preview"]>(null);
  const [parameters, setParameters] = useState<string[]>([]);
  const [patientName, setPatientName] = useState(plan.patient_name || plan.patient || plan.name);

  const applyPreview = useCallback(
    (data: SubscriptionMedicationWhatsAppPreview) => {
      setTemplates(data.templates || []);
      setPhone(data.phone_number || "");
      setPatientName(data.patient_name || plan.patient_name || plan.name);
      setSelectedTemplate(data.selected_template || "");
      setPreview(data.preview);
      setParameters(data.parameters || []);
      if (data.country && data.country_isd) {
        setCountryHint(`${data.country} (+${data.country_isd})`);
        setCountryIsd(data.country_isd);
      } else if (data.country_isd) {
        setCountryHint(`+${data.country_isd}`);
        setCountryIsd(data.country_isd);
      } else {
        setCountryHint("");
        setCountryIsd("");
      }
    },
    [plan.name, plan.patient_name]
  );

  const loadPreview = useCallback(
    async (templateName?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSubscriptionMedicationWhatsAppPreview(plan.name, templateName);
        applyPreview(data);
        if (!templateName && !data.selected_template && data.templates.length === 1) {
          const only = data.templates[0].name;
          const filled = await getSubscriptionMedicationWhatsAppPreview(plan.name, only);
          applyPreview(filled);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load WhatsApp preview");
      } finally {
        setLoading(false);
      }
    },
    [plan.name, applyPreview]
  );

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const handleTemplateChange = async (name: string) => {
    setSelectedTemplate(name);
    if (!name) {
      setPreview(null);
      setParameters([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getSubscriptionMedicationWhatsAppPreview(plan.name, name);
      applyPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load template preview");
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setError("Enter the patient WhatsApp number");
      return;
    }
    if (templates.length > 1 && !selectedTemplate) {
      setError("Select a template to send");
      return;
    }

    const templateToSend = selectedTemplate || templates[0]?.name || undefined;
    setSending(true);
    setError(null);
    try {
      await sendSubscriptionMedicationReminder(plan.name, "whatsapp", {
        phone_number: trimmedPhone,
        template_name: templateToSend,
        template_parameters: parameters,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send WhatsApp";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const canSend =
    !loading &&
    !sending &&
    Boolean(phone.trim()) &&
    (templates.length === 0 || templates.length === 1 || Boolean(selectedTemplate)) &&
    Boolean(preview);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={onClose} />
      <div
        className="relative pointer-events-auto w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 py-4 border-b border-emerald-100 dark:border-emerald-900/40 bg-gradient-to-r from-emerald-50 via-white to-teal-50 dark:from-emerald-950/40 dark:via-gray-900 dark:to-teal-950/30">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={18} className="text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Send WhatsApp Reminder</h2>
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300 truncate">{patientName}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{plan.name}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-emerald-100/60 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSend} className="p-6 space-y-4">
          {loading && !preview ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading message preview…</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Patient number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 973xxxxxxxx"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {countryIsd
                    ? `Defaults to patient mobile with ${countryHint}. Local numbers like 07… become ${countryIsd}…. You can edit before sending.`
                    : "Confirm or edit the patient WhatsApp number before sending. Include country code with + if needed."}
                </p>
              </div>

              {templates.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Template
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => void handleTemplateChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="">Select a template…</option>
                    {templates.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.purpose ? `${t.template_name} (${t.purpose})` : t.template_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {templates.length === 1 && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Template:{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {templates[0].template_name}
                  </span>
                  {templates[0].purpose ? ` · ${templates[0].purpose}` : ""}
                </div>
              )}

              {templates.length === 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  No mapped WhatsApp template — free-text reminder will be sent.
                </div>
              )}

              {preview && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Message preview
                  </label>
                  <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-800/50 bg-[#e7ffdb] dark:bg-emerald-950/40 p-4 shadow-sm">
                    {preview.header ? (
                      <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-emerald-50">
                        {preview.header}
                      </div>
                    ) : null}
                    <p className="text-sm text-slate-800 dark:text-emerald-50/90 whitespace-pre-wrap leading-relaxed">
                      {preview.body}
                    </p>
                    {preview.footer ? (
                      <div className="mt-3 border-t border-emerald-900/10 dark:border-emerald-200/10 pt-2 text-xs text-slate-500 dark:text-emerald-200/70">
                        {preview.footer}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {!loading && templates.length > 1 && !selectedTemplate && (
                <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  Select a template to see the message that will be sent.
                </p>
              )}
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-teal-50/80 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSend}
              className="px-5 py-2 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? "Sending…" : "Send WhatsApp"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
