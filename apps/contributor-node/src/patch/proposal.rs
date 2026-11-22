use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileChange {
    pub path: String,
    pub change_type: String,
    pub base_digest: String,
    pub replacement_content: String,
    pub replacement_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProposal {
    pub id: String,
    pub node_id: String,
    pub base_snapshot_id: String,
    pub base_manifest_digest: String,
    pub file_changes: Vec<PatchFileChange>,
    pub run_id: String,
    pub purpose_digest: String,
    pub patch_digest: String,
    pub security_label_id: String,
    pub state: String,
}

impl PatchProposal {
    pub fn validate(&self) -> Result<(), String> {
        if self.file_changes.is_empty() {
            return Err("patch_selection_required".into());
        }
        for change in &self.file_changes {
            if change.path.contains("..")
                || change.path.starts_with('/')
                || change.path.contains('\\')
            {
                return Err("patch_path_denied".into());
            }
        }
        Ok(())
    }
}
