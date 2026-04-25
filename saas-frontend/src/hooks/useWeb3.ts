"use client";

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { VAULT_ABI, BACKEND_URL, VAULT_ADDRESS_FALLBACK } from '@/lib/constants';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function useWeb3() {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [vaultContract, setVaultContract] = useState<ethers.Contract | null>(null);
  const [vaultAddress, setVaultAddress] = useState<string | null>(VAULT_ADDRESS_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/config`);
      const data = await response.json();
      setVaultAddress(data.vaultAddress);
      return data;
    } catch (err) {
      console.error("Failed to fetch backend config:", err);
      if (!VAULT_ADDRESS_FALLBACK) {
        setError("Backend offline and NEXT_PUBLIC_VAULT_ADDRESS not set — vault features unavailable.");
      }
      return VAULT_ADDRESS_FALLBACK ? { vaultAddress: VAULT_ADDRESS_FALLBACK } : null;
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setError("MetaMask not detected");
      return;
    }

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const rpcSigner = await browserProvider.getSigner();

      setAccount(accounts[0]);
      setProvider(browserProvider);
      setSigner(rpcSigner);

      const config = await fetchConfig();
      const resolvedAddress = config?.vaultAddress ?? VAULT_ADDRESS_FALLBACK;
      if (resolvedAddress) {
        const contract = new ethers.Contract(resolvedAddress, VAULT_ABI, rpcSigner);
        setVaultContract(contract);
        setVaultAddress(resolvedAddress);
      } else {
        setError("Vault address unknown — start the backend or set NEXT_PUBLIC_VAULT_ADDRESS.");
      }
    } catch (err: any) {
      console.error("Connection error:", err);
      setError(err.message || "Failed to connect wallet");
    }
  }, [fetchConfig]);

  const disconnectWallet = () => {
    setAccount(null);
    setSigner(null);
    setVaultContract(null);
  };

  useEffect(() => {
    fetchConfig().finally(() => setLoading(false));

    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        } else {
          setAccount(null);
        }
      };
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      return () => {
        window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [fetchConfig]);

  return {
    account,
    signer,
    provider,
    vaultContract,
    vaultAddress,
    connectWallet,
    disconnectWallet,
    loading,
    error
  };
}
