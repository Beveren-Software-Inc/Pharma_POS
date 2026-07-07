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
    idLabel: isHospitalPharmacy ? "File No" : "Customer ID",
    invoicesSection: isHospitalPharmacy ? "Dispense Orders" : "Customer Invoices",
    orderColumn: isHospitalPharmacy ? "Order" : "Invoice",
    totalOrdersLabel: isHospitalPharmacy ? "Total Dispense Orders" : "Total Invoices",
    searchOrdersPlaceholder: isHospitalPharmacy ? "Search dispense orders..." : "Search invoices...",
    noOrdersMessage: isHospitalPharmacy
      ? "No dispense orders found for this patient"
      : "No invoices found for this customer",
    loadMoreOrders: (loaded: number) =>
      isHospitalPharmacy
        ? `Load More Dispense Orders (${loaded} loaded)`
        : `Load More Customer Invoices (${loaded} loaded)`,
    allOrdersLoaded: (loaded: number) =>
      isHospitalPharmacy
        ? `All ${loaded} dispense orders loaded`
        : `All ${loaded} customer invoices loaded`,
    loadingDetails: isHospitalPharmacy ? "Loading patient details..." : "Loading customer details...",
    errorLoading: isHospitalPharmacy ? "Error loading patient" : "Error loading customer",
    notFound: isHospitalPharmacy ? "Patient not found" : "Customer not found",
    notFoundMessage: isHospitalPharmacy
      ? "The requested patient could not be found."
      : "The requested customer could not be found.",
    tablePartyColumn: singular,
  };
}
