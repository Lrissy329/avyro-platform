import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type ReviewMode = "guest_to_host" | "host_to_guest";

type ReviewFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  mode: ReviewMode;
  subjectLabel?: string | null;
  onSubmitted?: () => void;
};

const scoreOptions = Array.from({ length: 10 }, (_, index) => index + 1);

const defaultScores = {
  overall: 8,
  accuracy: 8,
  cleanliness: 8,
  communication: 8,
  checkin: 8,
  noise: 8,
  transport: 8,
  value: 8,
  rules: 8,
  punctuality: 8,
};

type ScoreFieldProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function ScoreField({ id, label, value, onChange }: ScoreFieldProps) {
  return (
    <label htmlFor={id} className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#FEDD02] focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/20"
      >
        {scoreOptions.map((score) => (
          <option key={score} value={score}>
            {score}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReviewFormModal({
  open,
  onOpenChange,
  bookingId,
  mode,
  subjectLabel,
  onSubmitted,
}: ReviewFormModalProps) {
  const [scores, setScores] = useState(defaultScores);
  const [wouldStayAgain, setWouldStayAgain] = useState<boolean>(true);
  const [wouldHostAgain, setWouldHostAgain] = useState<boolean>(true);
  const [publicComment, setPublicComment] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGuestFlow = mode === "guest_to_host";
  const modalTitle = isGuestFlow ? "How was your stay?" : "How was your guest?";
  const helperCopy = isGuestFlow
    ? "Your review helps other professionals know whether this place is a good fit."
    : "Share trusted feedback to help maintain reliable stays.";

  useEffect(() => {
    if (!open) return;
    setScores(defaultScores);
    setWouldStayAgain(true);
    setWouldHostAgain(true);
    setPublicComment("");
    setPrivateNote("");
    setError(null);
  }, [open, mode, bookingId]);

  const criteriaFields = useMemo(() => {
    if (isGuestFlow) {
      return [
        { key: "accuracy", label: "Accuracy" },
        { key: "cleanliness", label: "Cleanliness" },
        { key: "communication", label: "Communication" },
        { key: "checkin", label: "Check-in" },
        { key: "noise", label: "Noise / rest quality" },
        { key: "transport", label: "Transport access" },
        { key: "value", label: "Value" },
      ] as const;
    }
    return [
      { key: "communication", label: "Communication" },
      { key: "cleanliness", label: "Cleanliness" },
      { key: "rules", label: "Rules respect" },
      { key: "punctuality", label: "Punctuality" },
    ] as const;
  }, [isGuestFlow]);

  const submit = async () => {
    if (!bookingId) {
      setError("Missing booking context for this review.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      bookingId,
      reviewType: mode,
      overallScore: scores.overall,
      communicationScore: scores.communication,
      cleanlinessScore: scores.cleanliness,
      publicComment,
      privateNote,
    };

    if (isGuestFlow) {
      payload.accuracyScore = scores.accuracy;
      payload.checkinScore = scores.checkin;
      payload.noiseScore = scores.noise;
      payload.transportScore = scores.transport;
      payload.valueScore = scores.value;
      payload.wouldStayAgain = wouldStayAgain;
    } else {
      payload.rulesScore = scores.rules;
      payload.punctualityScore = scores.punctuality;
      payload.wouldHostAgain = wouldHostAgain;
    }

    try {
      const response = await fetch("/api/reviews/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "Unable to submit review.");
      }
      onSubmitted?.();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? "Unable to submit review.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{modalTitle}</DialogTitle>
          <DialogDescription>
            {helperCopy}
            <span className="mt-1 block text-xs text-slate-500">
              Reviews are published once both sides submit, or after the review window closes.
            </span>
            {subjectLabel ? (
              <span className="mt-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                Booking: {subjectLabel}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">Step 1 · Overall</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ScoreField
              id="review-overall-score"
              label="Overall score"
              value={scores.overall}
              onChange={(value) => setScores((prev) => ({ ...prev, overall: value }))}
            />

            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {isGuestFlow ? "Would stay again?" : "Would host again?"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    isGuestFlow ? setWouldStayAgain(true) : setWouldHostAgain(true)
                  }
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    (isGuestFlow ? wouldStayAgain : wouldHostAgain)
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() =>
                    isGuestFlow ? setWouldStayAgain(false) : setWouldHostAgain(false)
                  }
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    !(isGuestFlow ? wouldStayAgain : wouldHostAgain)
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  No
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">Step 2 · Criteria</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {criteriaFields.map((field) => (
              <ScoreField
                key={field.key}
                id={`review-${field.key}`}
                label={field.label}
                value={scores[field.key]}
                onChange={(value) =>
                  setScores((prev) => ({
                    ...prev,
                    [field.key]: value,
                  }))
                }
              />
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">Step 3 · Comments</p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Public comment
            </label>
            <Textarea
              value={publicComment}
              onChange={(event) => setPublicComment(event.target.value)}
              placeholder="Share what other professionals should know."
              rows={4}
              maxLength={1200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Private note (internal)
            </label>
            <Textarea
              value={privateNote}
              onChange={(event) => setPrivateNote(event.target.value)}
              placeholder="Optional note for internal visibility."
              rows={3}
              maxLength={2000}
            />
          </div>
        </section>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" className="rounded-xl" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

