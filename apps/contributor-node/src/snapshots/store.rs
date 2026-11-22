use std::collections::BTreeMap;

#[derive(Default)]
pub struct SealedSnapshotStore {
    entries: BTreeMap<(String, String), Vec<u8>>,
}

impl SealedSnapshotStore {
    pub fn seal(&mut self, manifest_id: &str, entry_id: &str, bytes: Vec<u8>) {
        self.entries
            .insert((manifest_id.to_string(), entry_id.to_string()), bytes);
    }

    pub fn read(&self, manifest_id: &str, entry_id: &str) -> Result<Vec<u8>, String> {
        self.entries
            .get(&(manifest_id.to_string(), entry_id.to_string()))
            .cloned()
            .ok_or_else(|| "snapshot_entry_not_found".into())
    }
}
