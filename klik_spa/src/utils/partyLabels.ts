/** User-facing Customer vs Patient labels based on POS profile mode. */
export function getPartyLabels(isHospitalPharmacy: boolean) {
  const singular = isHospitalPharmacy ? "Patient" : "Customer";
  const plural = isHospitalPharmacy ? "Patients" : "Customers";
  const lower = isHospitalPharmacy ? "patient" : "customer";

  return {
    singular,
    plural,
    lower,
    /** Count suffix under selected party (e.g. "5 visits" vs "5 orders"). */
    historyLabel: isHospitalPharmacy ? "visits" : "orders",
    nameLabel: `${singular} Name`,
    namePlaceholder: `${singular} name`,
    totalLabel: `Total ${plural}`,
    addNew: `Add New ${singular}`,
    edit: `Edit ${singular}`,
    save: `Save ${singular}`,
    update: `Update ${singular}`,
    backTo: `Back to ${plural}`,
    groupLabel: isHospitalPharmacy ? "Patient Group" : "Customer Group",
    typeLabel: isHospitalPharmacy ? "Patient Type" : "Customer Type",
  };
}
