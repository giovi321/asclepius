import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ResponsiveTable, { type ColumnSpec } from "./ResponsiveTable";

interface Row {
  id: number;
  name: string;
  status: string;
  date: string;
}

const columns: ColumnSpec<Row>[] = [
  {
    key: "name",
    header: "Name",
    cell: (r) => r.name,
    sortable: true,
    mobile: { role: "title" },
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => r.status,
    mobile: { role: "badge" },
  },
  {
    key: "date",
    header: "Date",
    cell: (r) => r.date,
    mobile: { role: "meta" },
  },
];

const rows: Row[] = [
  { id: 1, name: "Blood panel", status: "done", date: "2026-01-02" },
  { id: 2, name: "MRI report", status: "pending", date: "2026-03-04" },
];

describe("ResponsiveTable", () => {
  it("renders both the table and the card list (CSS decides visibility)", () => {
    render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    // Desktop rendering
    const table = screen.getByRole("table");
    expect(within(table).getByText("Blood panel")).toBeInTheDocument();
    // Card rendering
    const list = screen.getByRole("list");
    expect(within(list).getByText("Blood panel")).toBeInTheDocument();
  });

  it("fires onRowClick from a card tap", () => {
    const onRowClick = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const list = screen.getByRole("list");
    fireEvent.click(within(list).getByText("MRI report"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("fires onSortChange from a sortable header", () => {
    const onSortChange = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });

  it("toggles selection without triggering row navigation", () => {
    const onRowClick = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
        selectable
        selectedIds={new Set([1])}
        onToggleSelect={onToggleSelect}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox", { name: "Select row" });
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[0]);
    expect(onToggleSelect).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders the empty slot when there are no rows", () => {
    render(
      <ResponsiveTable
        columns={columns}
        rows={[]}
        getRowId={(r: Row) => r.id}
        empty={<p>No documents yet</p>}
      />,
    );
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
  });

  it("renders skeletons while loading", () => {
    const { container } = render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        loading
      />,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("Blood panel")).toBeNull();
  });

  it("supports a full custom card override", () => {
    render(
      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        renderCard={(r) => <em>custom {r.name}</em>}
      />,
    );
    expect(screen.getByText("custom Blood panel")).toBeInTheDocument();
  });
});
