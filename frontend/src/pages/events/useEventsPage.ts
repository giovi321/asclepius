import { useEvents } from "@/hooks/data";
import type { Patient } from "@/types";

/**
 * Owns the events-list data the EventsPage renders: the events array, the
 * loading flag, and the ``loadEvents`` refetch. Extracted verbatim from the
 * page — same shared cache hook, same ``Array.isArray`` guard, same refetch
 * wrapper. Per-event detail/edit state stays in the page (it's coupled to
 * the expand/edit handlers).
 */
export function useEventsPage(selectedPatient: Patient | null) {
  const {
    data: eventsData,
    loading,
    refetch,
  } = useEvents({ patientId: selectedPatient?.id });
  const events = Array.isArray(eventsData) ? eventsData : [];
  const loadEvents = () => refetch();

  return { events, loading, loadEvents };
}
