import { Configuration, LogLevel } from "@azure/msal-browser";

const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || "";
const tenantId = process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "";
const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI || "http://localhost:3000";

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    cacheLocation: "localStorage",
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
        }
      },
      logLevel: LogLevel.Warning,
    },
  },
};

export const loginRequest = {
  scopes: [
    "openid",
    "profile",
    "offline_access",
  ],
};

export const dataverseScopes = (orgUrl: string) => ({
  scopes: [`${orgUrl}/user_impersonation`],
});

export const powerPlatformAdminScopes = {
  scopes: ["https://globaldisco.crm.dynamics.com/user_impersonation"],
};

export const organizationsAuthority = "https://login.microsoftonline.com/organizations";
