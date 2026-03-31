"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  AccountInfo,
  type SilentRequest,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { msalConfig, loginRequest, powerPlatformAdminScopes, dataverseScopes, organizationsAuthority } from "./msal-config";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  account: AccountInfo | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: (scopes: string[]) => Promise<string>;
  getDataverseToken: (orgUrl: string) => Promise<string>;
  getPowerPlatformAdminToken: () => Promise<string>;
  error: string | null;
  // Cross-tenant support
  targetAccount: AccountInfo | null;
  loginForTarget: () => Promise<void>;
  logoutTarget: () => void;
  getTargetAdminToken: () => Promise<string>;
  registerOrgAccount: (orgUrl: string, account: AccountInfo) => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  account: null,
  login: async () => {},
  logout: async () => {},
  getAccessToken: async () => "",
  getDataverseToken: async () => "",
  getPowerPlatformAdminToken: async () => "",
  error: null,
  targetAccount: null,
  loginForTarget: async () => {},
  logoutTarget: () => {},
  getTargetAdminToken: async () => "",
  registerOrgAccount: () => {},
});

/**
 * Single module-level promise: initialize MSAL + handleRedirectPromise.
 * This MUST resolve before ANY interactive call (loginPopup, loginRedirect, etc.).
 * Calling it multiple times returns the same promise.
 */
let msalReadyPromise: Promise<{ instance: PublicClientApplication; redirectResult: AuthenticationResult | null }> | null = null;

function getMsalReady() {
  if (!msalReadyPromise) {
    msalReadyPromise = (async () => {
      const instance = new PublicClientApplication(msalConfig);
      await instance.initialize();
      let redirectResult: AuthenticationResult | null = null;
      try {
        redirectResult = await instance.handleRedirectPromise();
      } catch {
        // Ignore — popup windows or stale cache will throw here
      }
      return { instance, redirectResult };
    })();
  }
  return msalReadyPromise;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [targetAccount, setTargetAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Maps orgUrl → AccountInfo for smart token routing
  const orgAccountMapRef = useRef<Map<string, AccountInfo>>(new Map());

  useEffect(() => {
    getMsalReady()
      .then(({ instance, redirectResult }) => {
        if (redirectResult?.account) {
          instance.setActiveAccount(redirectResult.account);
          setAccount(redirectResult.account);
          setIsAuthenticated(true);
        } else {
          const accounts = instance.getAllAccounts();
          if (accounts.length > 0) {
            instance.setActiveAccount(accounts[0]);
            setAccount(accounts[0]);
            setIsAuthenticated(true);
          }
        }
      })
      .catch((err) => {
        console.error("MSAL init error:", err);
        setError(err instanceof Error ? err.message : "Authentication initialization failed");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async () => {
    try {
      setError(null);
      const { instance } = await getMsalReady();
      await instance.loginRedirect(loginRequest);
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const { instance } = await getMsalReady();
      orgAccountMapRef.current.clear();
      setTargetAccount(null);
      await instance.logoutRedirect({ postLogoutRedirectUri: msalConfig.auth.redirectUri });
      setAccount(null);
      setIsAuthenticated(false);
    } catch (err) {
      console.error("Logout error:", err);
    }
  }, []);

  // Register which account owns an org URL (for smart token routing)
  const registerOrgAccount = useCallback((orgUrl: string, acct: AccountInfo) => {
    orgAccountMapRef.current.set(orgUrl.replace(/\/$/, "").toLowerCase(), acct);
  }, []);

  // Core token acquisition for a specific account
  const getAccessTokenForAccount = useCallback(async (scopes: string[], acct: AccountInfo): Promise<string> => {
    const { instance } = await getMsalReady();
    const request: SilentRequest = {
      scopes,
      account: acct,
      authority: `https://login.microsoftonline.com/${acct.tenantId}`,
    };
    try {
      const response = await instance.acquireTokenSilent(request);
      return response.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const popupRedirectUri = `${window.location.origin}/popup-redirect.html`;
          const response = await instance.acquireTokenPopup({
            scopes,
            account: acct,
            authority: `https://login.microsoftonline.com/${acct.tenantId}`,
            redirectUri: popupRedirectUri,
          });
          return response.accessToken;
        } catch (popupErr) {
          console.error("Popup token acquisition failed, falling back to redirect:", popupErr);
          await instance.acquireTokenRedirect({ scopes });
          return "";
        }
      }
      throw err;
    }
  }, []);

  // Original getAccessToken — uses primary account
  const getAccessToken = useCallback(async (scopes: string[]): Promise<string> => {
    const { instance } = await getMsalReady();
    const activeAccount = instance.getActiveAccount();
    if (!activeAccount) throw new Error("No active account. Please log in.");
    return getAccessTokenForAccount(scopes, activeAccount);
  }, [getAccessTokenForAccount]);

  // Smart getDataverseToken — resolves correct account via org URL mapping
  const getDataverseToken = useCallback(
    async (orgUrl: string): Promise<string> => {
      const normalizedUrl = orgUrl.replace(/\/$/, "").toLowerCase();
      const acct = orgAccountMapRef.current.get(normalizedUrl) || account;
      if (!acct) throw new Error("No active account. Please log in.");
      return getAccessTokenForAccount(
        dataverseScopes(orgUrl.replace(/\/$/, "")).scopes,
        acct
      );
    },
    [account, getAccessTokenForAccount]
  );

  const getPowerPlatformAdminToken = useCallback(async (): Promise<string> => {
    return getAccessToken(powerPlatformAdminScopes.scopes);
  }, [getAccessToken]);

  // Cross-tenant: Login for target tenant via popup
  const loginForTarget = useCallback(async () => {
    try {
      setError(null);
      const { instance } = await getMsalReady();
      const popupRedirectUri = `${window.location.origin}/popup-redirect.html`;
      const response = await instance.loginPopup({
        authority: organizationsAuthority,
        scopes: ["openid", "profile", "offline_access"],
        redirectUri: popupRedirectUri,
        prompt: "select_account",
      });
      if (response?.account) {
        setTargetAccount(response.account);
      }
    } catch (err) {
      console.error("Target login error:", err);
      setError(err instanceof Error ? err.message : "Target tenant login failed. Ensure your Azure AD app registration supports multi-tenant access.");
    }
  }, []);

  const logoutTarget = useCallback(() => {
    setTargetAccount(null);
    // Remove target org URLs from the mapping
    const currentMap = orgAccountMapRef.current;
    for (const [url, acct] of currentMap.entries()) {
      if (targetAccount && acct.tenantId === targetAccount.tenantId) {
        currentMap.delete(url);
      }
    }
  }, [targetAccount]);

  // Admin token using target account (for cross-tenant env discovery)
  const getTargetAdminToken = useCallback(async (): Promise<string> => {
    if (!targetAccount) throw new Error("No target account. Please sign in to the target tenant first.");
    return getAccessTokenForAccount(powerPlatformAdminScopes.scopes, targetAccount);
  }, [targetAccount, getAccessTokenForAccount]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        account,
        login,
        logout,
        getAccessToken,
        getDataverseToken,
        getPowerPlatformAdminToken,
        error,
        targetAccount,
        loginForTarget,
        logoutTarget,
        getTargetAdminToken,
        registerOrgAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
