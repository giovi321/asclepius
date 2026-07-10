import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import IconButton from "@/components/ui/IconButton";

export interface RegionThumbLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string | null;
  alt?: string;
}

/**
 * In-app image lightbox for region-translation thumbnails.
 *
 * Replaces the old hover-preview + new-tab anchor pattern: works on touch,
 * and keeps protected images inside the app (no target="_blank" opens, no
 * object URLs). The image keeps the contextmenu suppressed and long-press
 * callouts disabled.
 *
 * Tap/click anywhere closes; Esc closes via Radix; a visible 44px close
 * button sits top-right (safe-area aware).
 */
export default function RegionThumbLightbox({
  open,
  onOpenChange,
  src,
  alt,
}: RegionThumbLightboxProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-overlay bg-black/80",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-base",
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          onClick={() => onOpenChange(false)}
          className={cn(
            "fixed inset-0 z-overlay flex items-center justify-center p-4 outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-base",
          )}
        >
          <Dialog.Title className="sr-only">
            {alt || "Image preview"}
          </Dialog.Title>
          {src && (
            <img
              src={src}
              alt={alt || ""}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              className="max-h-[85dvh] max-w-full object-contain no-touch-callout"
            />
          )}
          <Dialog.Close asChild>
            <IconButton
              label="Close"
              size="lg"
              className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] text-white hover:bg-white/15 hover:text-white active:bg-white/15"
            >
              <X className="h-5 w-5" />
            </IconButton>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
