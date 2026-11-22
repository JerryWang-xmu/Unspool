export function prepareFederatedHandoff(
  grants: readonly { id: string; operations: readonly string[] }[],
) {
  return {
    grants: grants.map((grant) => ({
      ...grant,
      operations: grant.operations.filter((operation) => operation === "snapshot.read"),
    })),
    privateDataInherited: false,
    privateReassignment: false,
  };
}

export function acceptFederatedHandoff(input: {
  highRisk: boolean;
  sourceReconfirmed: boolean;
  recipientReconfirmed: boolean;
}) {
  if (input.highRisk && (!input.sourceReconfirmed || !input.recipientReconfirmed)) {
    throw new Error("high_risk_reconfirmation_required");
  }
  return { accepted: true, privateDataInherited: false };
}
