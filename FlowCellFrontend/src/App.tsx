import AppBase from "./AppBase";
import { getWindowContextFromLocation } from "./lib/windowContext";
import OrganizationSetupWindowPagePatched from "./pages/organization-setup/OrganizationSetupWindowPagePatched";

export default function App() {
  const windowContext = getWindowContextFromLocation();

  if (windowContext.kind === "organization-setup") {
    return <OrganizationSetupWindowPagePatched />;
  }

  return <AppBase />;
}
