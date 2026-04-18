import { useState, useRef, useCallback } from 'react';
import { ReturnUpcCount, ScanEventLogEntry, QuantityChangeLogEntry, ScanEventStatus, QuantityChangeReason } from '../types';
import { useNinpoCore } from './useNinpoCore';
import { BACKEND_URL } from '../constants';

const UPC_ELIGIBILITY_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

export const useReturnScanner = () => {
  const { addToast } = useNinpoCore();
  const [verifiedReturnUpcs, setVerifiedReturnUpcs] = useState<ReturnUpcCount[]>([]);
  const [manualUpc, setManualUpc] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [lastBlockedUpc, setLastBlockedUpc] = useState<string | null>(null);
  const [lastBlockedReason, setLastBlockedReason] = useState<'cooldown' | 'duplicate' | null>(null);
  const [pendingDuplicateScan, setPendingDuplicateScan] = useState<{ upc: string; recordedAt: number } | null>(null);
  const [scanEvents, setScanEvents] = useState<ScanEventLogEntry[]>([]);
  const [quantityEvents, setQuantityEvents] = useState<QuantityChangeLogEntry[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const eligibilityCacheRef = useRef<Record<string, { isEligible: boolean; checkedAt: string }>>({});
  const lastScanRef = useRef<{ upc: string; at: number } | null>(null);
  const verifiedReturnUpcsRef = useRef<ReturnUpcCount[]>([]);

  const playScannerTone = useCallback((frequency: number, durationMs: number, gain = 0.2) => {
    if (typeof window === 'undefined') return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const context = audioContextRef.current;
    if (context.state === 'suspended') {
      context.resume();
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gainNode.gain.value = gain;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationMs / 1000);
  }, []);

  const logScanEvent = useCallback((entry: Omit<ScanEventLogEntry, 'id' | 'recordedAt'>) => {
    const id = `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setScanEvents(prev => [...prev, { id, recordedAt: new Date().toISOString(), ...entry }]);
  }, []);

  const logQuantityChange = useCallback((entry: Omit<QuantityChangeLogEntry, 'id' | 'recordedAt'>) => {
    const id = `qty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setQuantityEvents(prev => [...prev, { id, recordedAt: new Date().toISOString(), ...entry }]);
  }, []);

  const updateEligibilityCache = (upc: string, isEligible: boolean) => {
    eligibilityCacheRef.current = { ...eligibilityCacheRef.current, [upc]: { isEligible, checkedAt: new Date().toISOString() } };
  };

  const isEligibilityCacheFresh = (checkedAt?: string) => {
    if (!checkedAt) return false;
    const parsed = Date.parse(checkedAt);
    return Number.isFinite(parsed) && Date.now() - parsed < UPC_ELIGIBILITY_TTL_MS;
  };

  const addEligibleUpc = useCallback((upc: string, reason: QuantityChangeReason = 'scan_add') => {
    let didAdd = false;
    setVerifiedReturnUpcs(prev => {
      if (prev.some(entry => entry.upc === upc)) return prev;
      didAdd = true;
      return [{ upc, quantity: 1 }, ...prev];
    });

    if (didAdd) {
      setScannerError(null);
      setManualUpc('');
      logQuantityChange({ upc, delta: 1, reason });
      playScannerTone(980, 120, 0.2);
    } else {
      playScannerTone(220, 240, 0.25);
      setScannerError('This container may already be counted.');
    }
  }, [logQuantityChange, playScannerTone]);

  const addUpc = useCallback(async (upcRaw: string, source: 'scanner' | 'manual' = 'manual') => {
    const upc = String(upcRaw || '').replace(/\s+/g, '').trim();
    if (!upc) return;

    if (pendingDuplicateScan && pendingDuplicateScan.upc !== upc) {
      setPendingDuplicateScan(null);
    }

    if (source === 'scanner') {
      const now = Date.now();
      const lastScan = lastScanRef.current;
      const alreadyVerified = verifiedReturnUpcsRef.current.some(entry => entry.upc === upc);
      if (alreadyVerified && lastScan?.upc === upc && now - lastScan.at < 4000) {
        setPendingDuplicateScan({ upc, recordedAt: now });
        setScannerError(null);
        playScannerTone(440, 120, 0.2);
        logScanEvent({ upc, source, status: 'duplicate_prompt' });
        lastScanRef.current = { upc, at: now };
        return;
      }

      if (lastScan && now - lastScan.at < 1200) {
        playScannerTone(220, 240, 0.25);
        setScannerError('Scan paused. Wait a moment or tap + to increment.');
        logScanEvent({ upc, source, status: 'cooldown_blocked' });
        return;
      }
      lastScanRef.current = { upc, at: now };
      logScanEvent({ upc, source, status: 'detected' });
    }

    if (!/^\d{8,14}$/.test(upc)) {
      playScannerTone(220, 240, 0.25);
      setScannerError('Invalid UPC format. Enter 8–14 digits.');
      if (source === 'scanner') logScanEvent({ upc, source, status: 'invalid_format' });
      return;
    }

    const cached = eligibilityCacheRef.current[upc];
    if (cached && isEligibilityCacheFresh(cached.checkedAt)) {
      if (!cached.isEligible) {
        playScannerTone(220, 240, 0.25);
        setScannerError("This container isn't eligible for return value.");
        if (source === 'scanner') logScanEvent({ upc, source, status: 'ineligible' });
        return;
      }
      addEligibleUpc(upc, source === 'manual' ? 'manual_add' : 'scan_add');
      if (source === 'scanner') logScanEvent({ upc, source, status: 'eligible' });
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/upc/eligibility?upc=${encodeURIComponent(upc)}`);
      if (response.ok) {
        const data = await response.json();
        const isEligible = data?.eligible !== false;
        updateEligibilityCache(upc, isEligible);
        if (!isEligible) {
          playScannerTone(220, 240, 0.25);
          setScannerError("This container isn't eligible for return value.");
          if (source === 'scanner') logScanEvent({ upc, source, status: 'ineligible' });
          return;
        }
        addEligibleUpc(upc, source === 'manual' ? 'manual_add' : 'scan_add');
        if (source === 'scanner') logScanEvent({ upc, source, status: 'eligible' });
      } else if (response.status === 404) {
        updateEligibilityCache(upc, false);
        playScannerTone(220, 240, 0.25);
        setScannerError("This container isn't eligible for return value.");
        if (source === 'scanner') logScanEvent({ upc, source, status: 'ineligible' });
      } else {
        throw new Error(`Eligibility check failed: ${response.status}`);
      }
    } catch {
      playScannerTone(220, 240, 0.25);
      setScannerError('Unable to validate UPC eligibility. Please try again.');
    }
  }, [addEligibleUpc, logScanEvent, playScannerTone, pendingDuplicateScan]);

  const clearUpcs = () => {
    setVerifiedReturnUpcs([]);
    setScannerError(null);
    setPendingDuplicateScan(null);
  };

  return {
    verifiedReturnUpcs,
    setVerifiedReturnUpcs,
    manualUpc,
    setManualUpc,
    scannerError,
    setScannerError,
    lastBlockedUpc,
    setLastBlockedUpc,
    lastBlockedReason,
    setLastBlockedReason,
    pendingDuplicateScan,
    setPendingDuplicateScan,
    scanEvents,
    setScanEvents,
    quantityEvents,
    setQuantityEvents,
    addUpc,
    clearUpcs,
    verifiedReturnUpcsRef,
  };
};