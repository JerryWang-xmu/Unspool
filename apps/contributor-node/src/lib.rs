#![forbid(unsafe_code)]

//! Contributor-node canonical models and policy boundaries.

pub mod domain {
    pub mod contributor_node;
    pub mod fixed_tool_template;
    pub mod node_operation;
    pub mod node_policy_state;
    pub mod receipt_gap;
    pub mod resource_registration;
    pub mod snapshot_manifest;
    pub mod tool_execution;
}

pub mod patch {
    pub mod applier;
    pub mod generator;
    pub mod proposal;
}

pub mod identity {
    pub mod pairing;
}

pub mod operations {
    pub mod recovery;
}

pub mod policy {
    pub mod directives;
    pub mod gates;
    pub mod grants;
    pub mod leases;
    pub mod operation_tickets;
}

pub mod resources {
    pub mod registration;
}

pub mod snapshots {
    pub mod builder;
    pub mod preview;
    pub mod reader;
    pub mod store;
}

pub mod tools {
    pub mod budget;
    pub mod registry;
    pub mod sandbox;
}

pub mod transport {
    pub mod long_poll;
}
