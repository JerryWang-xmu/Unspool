#![forbid(unsafe_code)]

//! Boundary crate for Unspool's local security core.
//!
//! Grant enforcement, key handling, and cryptographic primitives are added by their
//! implementation tasks; this crate only establishes the reviewed workspace boundary.

pub mod operation_ticket;
pub mod revocation_directive;
