import { useState } from "react";
import { Share2 } from "lucide-react";

import ShareDialog from "@/components/share/ShareDialog";

interface ShareWithDoctorButtonProps {
  patientId: number | null;
  documentId: number;
  patientName?: string | null;
  documentLabel?: string | null;
}

/**
 * Single-document trigger for the share dialog. Lives next to Delete on
 * the Document Detail page. Dialog state is local so the button only
 * mounts the dialog while it's open.
 */
export default function ShareWithDoctorButton({
  patientId,
  documentId,
  patientName,
  documentLabel,
}: ShareWithDoctorButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!patientId}
        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        title={
          patientId
            ? "Create a read-only doctor share for this document"
            : "Assign this document to a patient before sharing"
        }
      >
        <Share2 className="h-4 w-4" /> Share with doctor
      </button>
      <ShareDialog
        open={open}
        onClose={() => setOpen(false)}
        patientId={patientId}
        documentIds={[documentId]}
        patientName={patientName}
        selectionLabel={documentLabel || `Document #${documentId}`}
      />
    </>
  );
}
