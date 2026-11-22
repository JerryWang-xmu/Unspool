use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub entry_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logical_path: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub size: u64,
    pub content_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    pub id: String,
    pub node_id: String,
    pub resource_id: String,
    pub root_digest: String,
    pub entries: Vec<SnapshotEntry>,
    pub created_at: String,
    pub path_visibility: String,
    pub cache_policy: CachePolicy,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePolicy {
    pub central_cache: bool,
    pub offline_read: bool,
}

impl SnapshotManifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.entries.is_empty() {
            return Err("snapshot_manifest_invalid".into());
        }
        if !["opaque_only", "authorized_recipients", "owner_only"]
            .contains(&self.path_visibility.as_str())
        {
            return Err("snapshot_path_visibility_invalid".into());
        }
        Ok(())
    }
}
