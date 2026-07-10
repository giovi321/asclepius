import { Syringe } from "lucide-react";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";
import Badge from "@/components/ui/Badge";
import { useBreakpoint } from "@/hooks/useMediaQuery";

export function VaccinationsSection({ vaccinations }: { vaccinations: any[] }) {
  const { isMobile } = useBreakpoint();
  if (!vaccinations?.length) return null;
  return (
    <Section
      title="Vaccinations"
      icon={Syringe}
      sectionId="vaccinations"
      defaultOpen={!isMobile}
      headerExtra={<Badge size="sm">{vaccinations.length}</Badge>}
    >
      {vaccinations.map((vax) => (
        <div key={vax.id} className="text-sm">
          <span className="font-medium">{vax.vaccine_name}</span>
          {vax.date_administered && (
            <span className="text-muted-foreground">
              {" "}
              \u2014 {vax.date_administered}
            </span>
          )}
          {vax.dose_number && (
            <span className="text-muted-foreground">
              {" "}
              (dose {vax.dose_number})
            </span>
          )}
        </div>
      ))}
    </Section>
  );
}
