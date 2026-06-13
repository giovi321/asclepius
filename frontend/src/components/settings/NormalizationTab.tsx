import NormalizationToolbar from "./normalization/NormalizationToolbar";
import AutoMergePanel from "./normalization/AutoMergePanel";
import LinkedDocumentsModal from "./normalization/LinkedDocumentsModal";
import BatchMergeBar from "./normalization/BatchMergeBar";
import NormalizationTable from "./normalization/NormalizationTable";
import { useNormalization } from "./normalization/useNormalization";

export default function NormalizationTab() {
  const n = useNormalization();

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Normalization maps different names for the same medical concept (e.g.
        "CBC", "Complete Blood Count", "Emocromo") to a single canonical entry.
        Click a row to view and manage its aliases, edit the canonical name, or
        merge duplicates.
      </div>

      <NormalizationToolbar
        normType={n.normType}
        onNormTypeChange={n.setNormType}
        normFilter={n.normFilter}
        onNormFilterChange={n.setNormFilter}
        searchInput={n.searchInput}
        onSearchInputChange={n.setSearchInput}
        onSearchCommit={n.setSearchQuery}
        onAutoMerge={n.handleAutoMerge}
        autoMergeLoading={n.autoMergeLoading}
        canAutoMerge={n.normItems.length >= 2}
        itemCount={n.normItems.length}
      />

      {n.autoMergeProposals !== null && (
        <AutoMergePanel
          proposals={n.autoMergeProposals}
          entries={n.autoMergeEntries}
          onClose={() => n.setAutoMergeProposals(null)}
          onApply={n.applyProposal}
          onSkip={(idx) =>
            n.setAutoMergeProposals(
              (prev) => prev?.filter((_, i) => i !== idx) ?? null,
            )
          }
          onUpdateTarget={n.updateProposalTarget}
          onToggleSource={n.toggleProposalSource}
        />
      )}

      {n.linkedDocsFor && (
        <LinkedDocumentsModal
          subjectName={n.linkedDocsFor.name}
          loading={n.linkedLoading}
          documents={n.linkedDocs}
          onClose={n.closeLinkedDocs}
          onDelete={() =>
            n.linkedDocsFor &&
            n.handleDelete(n.linkedDocsFor.id, n.linkedDocsFor.name)
          }
        />
      )}

      <BatchMergeBar
        selectedCount={n.selectedIds.size}
        normItems={n.normItems}
        selectedIds={n.selectedIds}
        batchTargetId={n.batchTargetId}
        onBatchTargetChange={n.setBatchTargetId}
        batchNewDisplay={n.batchNewDisplay}
        onBatchNewDisplayChange={n.setBatchNewDisplay}
        batchNewCode={n.batchNewCode}
        onBatchNewCodeChange={n.setBatchNewCode}
        onMerge={n.handleBatchMerge}
        onClear={() => {
          n.setSelectedIds(new Set());
          n.setBatchTargetId(null);
          n.setBatchNewDisplay("");
          n.setBatchNewCode("");
        }}
      />

      <NormalizationTable
        normItems={n.normItems}
        detail={n.detail}
        expandedId={n.expandedId}
        editing={n.editing}
        editCode={n.editCode}
        editDisplay={n.editDisplay}
        saveError={n.saveError}
        newAlias={n.newAlias}
        newAliasLang={n.newAliasLang}
        showMergeFor={n.showMergeFor}
        mergeTargetId={n.mergeTargetId}
        rowNewDisplay={n.rowNewDisplay}
        rowNewCode={n.rowNewCode}
        searchQuery={n.searchQuery}
        selectedIds={n.selectedIds}
        onToggleSelectAll={n.toggleSelectAll}
        onToggleSelect={n.toggleSelect}
        onToggleExpand={n.toggleExpand}
        onViewDocuments={n.handleViewDocuments}
        onSetShowMergeFor={n.setShowMergeFor}
        onCancelMerge={() => {
          n.setShowMergeFor(null);
          n.setMergeTargetId(null);
          n.setRowNewDisplay("");
          n.setRowNewCode("");
        }}
        onDelete={n.handleDelete}
        onStartEdit={() => n.setEditing(true)}
        onCancelEdit={() => {
          n.setEditing(false);
          n.setSaveError(null);
          n.setEditCode(n.detail?.canonical_code || "");
          n.setEditDisplay(n.detail?.canonical_display || "");
        }}
        onEditCodeChange={n.setEditCode}
        onEditDisplayChange={n.setEditDisplay}
        onSaveEdit={n.handleSaveEdit}
        onNewAliasChange={n.setNewAlias}
        onNewAliasLangChange={n.setNewAliasLang}
        onAddAlias={n.handleAddAlias}
        onDeleteAlias={n.handleDeleteAlias}
        onConfirmAll={n.handleConfirmAll}
        onMergeTargetChange={n.setMergeTargetId}
        onRowNewDisplayChange={n.setRowNewDisplay}
        onRowNewCodeChange={n.setRowNewCode}
        onMerge={(id) => n.mergeTargetId && n.handleMerge(id, n.mergeTargetId)}
      />
    </div>
  );
}
