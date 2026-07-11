import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, CreditCard, Banknote, Wallet, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';
import { formatCurrency } from '../utils/currency';
import { useCreatePOSOpeningEntry } from '../services/opeiningEntry';
import { usePaymentModes } from "../hooks/usePaymentModes"
import { usePOSProfiles, usePOSDetails } from '../hooks/usePOSProfile';
import { clearAllCache } from '../utils/clearCache';

interface PaymentMethod {
  mode_of_payment: string;
  opening_amount: number;
  type: 'Cash' | 'Bank' | 'General';
  account?: string;
}

interface POSOpeningEntry {
  name?: string;
  pos_profile: string;
  period_start_date: string;
  period_end_date?: string;
  company: string;
  user: string;
  balance_details: PaymentMethod[];
  status: 'Open' | 'Closed';
}

interface POSOpeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (openingEntry?: POSOpeningEntry) => void;
  currentUser: string;
}

interface PosProfileSelectProps {
  profiles: { name: string; is_default: boolean; custom_is_hospital_pharmacy?: number | boolean | string }[];
  value: string;
  onChange: (profileName: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

function isHospitalProfileFlag(value: number | boolean | string | undefined): boolean {
  return value === 1 || value === true || value === "1";
}

function PosProfileSelect({
  profiles,
  value,
  onChange,
  disabled = false,
  loading = false,
}: PosProfileSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedProfile = profiles.find((profile) => profile.name === value);
  const displayLabel = loading
    ? 'Loading profiles...'
    : selectedProfile
      ? selectedProfile.is_default
        ? `${selectedProfile.name} (Default)`
        : selectedProfile.name
      : profiles.length === 0
        ? 'No profiles available'
        : 'Select POS Profile';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && !loading && setOpen((prev) => !prev)}
        disabled={disabled || loading || profiles.length === 0}
        className="relative w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-900 shadow-sm transition focus:outline-none focus:border-beveren-400/80 focus:ring-2 focus:ring-beveren-500/25 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className="block truncate pr-6">{displayLabel}</span>
        <ChevronDown
          className={`absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && profiles.length > 0 && (
        <div className="absolute z-50 mt-1.5 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-slate-900 shadow-lg ring-1 ring-slate-200/60">
          {profiles.map((profile) => {
            const label = profile.is_default ? `${profile.name} (Default)` : profile.name;
            const isSelected = profile.name === value;

            return (
              <button
                key={profile.name}
                type="button"
                onClick={() => {
                  onChange(profile.name);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition hover:bg-beveren-50/80 focus:bg-beveren-50/80 focus:outline-none ${
                  isSelected ? 'bg-beveren-50/60 font-medium text-beveren-700' : 'text-slate-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const POSOpeningModal: React.FC<POSOpeningModalProps> = ({
  isOpen,
  onClose,

}) => {
  const [step, setStep] = useState<'form' | 'creating' | 'success'>('form');
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState<string>('');

  // Use your existing hooks
  const { createOpeningEntry, isCreating, error: createError, success } = useCreatePOSOpeningEntry();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { profiles: posProfiles, loading: profilesLoading, error: _profilesError } = usePOSProfiles();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { posDetails, loading: _posDetailsLoading } = usePOSDetails();

  // Get the active POS profile from the opening entry
  const activeProfileName = posDetails?.name as string | undefined;

  const isHospitalPharmacy = useMemo(() => {
    const selected = posProfiles?.find((p) => p.name === selectedProfile);
    return isHospitalProfileFlag(selected?.custom_is_hospital_pharmacy);
  }, [posProfiles, selectedProfile]);

  // Use payment modes hook - will fetch when selectedProfile changes
  // Use selectedProfile when opening the dialog, but activeProfileName if already open
  // This ensures users can change profiles and see the correct payment modes
  const profileForPaymentModes: string = selectedProfile || activeProfileName || "";
  const {
    modes: paymentModes,
    isLoading: paymentModesLoading,
    error: paymentModesError
  } = usePaymentModes(isHospitalPharmacy ? "" : profileForPaymentModes);


  // Payment method icons
  const getPaymentIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'cash':
        return <Banknote className="w-5 h-5 text-green-600" />;
      case 'bank':
        return <CreditCard className="w-5 h-5 text-blue-600" />;
      default:
        return <Wallet className="w-5 h-5 text-gray-600" />;
    }
  };

  // Set default profile when profiles are loaded
  useEffect(() => {
    if (posProfiles && posProfiles.length > 0 && !selectedProfile) {
      // First, try to use the active profile from the opening entry
      let profileToUse: { name: string } | null = null;

      if (activeProfileName) {
        // Find the active profile in the list
        profileToUse = posProfiles.find(p => p.name === activeProfileName) || null;
      }

      // If no active profile, use the default or first one
      if (!profileToUse) {
        const defaultProfile = posProfiles.find(p => p.is_default);
        profileToUse = defaultProfile || posProfiles[0] || null;
      }

      if (profileToUse?.name) {
        setSelectedProfile(profileToUse.name);
      }
    }
  }, [posProfiles, selectedProfile, activeProfileName]);

  // Handle profile selection change
  const handleProfileChange = (profileName: string) => {
    setSelectedProfile(profileName);
    // Don't reset payment methods here - let the useEffect handle it
    // when new payment modes arrive
  };

  // Update payment methods when payment modes are loaded
  useEffect(() => {
    if (isHospitalPharmacy) {
      setPaymentMethods([]);
      return;
    }

    if (selectedProfile && paymentModesLoading) {
      // Clear payment methods while loading
      setPaymentMethods([]);
    }

    if (paymentModes && paymentModes.length > 0 && !paymentModesLoading) {
      // Sort payment modes to put default payment method first
      const sortedPaymentModes = [...paymentModes].sort((a, b) => {
        // Default payment method (default === 1) should come first
        if (a.default === 1 && b.default !== 1) return -1;
        if (a.default !== 1 && b.default === 1) return 1;
        return 0; // Keep original order for non-default methods
      });

      //eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = sortedPaymentModes.map((payment: any) => ({
        mode_of_payment: payment.mode_of_payment,
        opening_amount: 0,
        type: payment.type || 'General',
        account: payment.default_account || payment.account
      }));
      setPaymentMethods(methods);
    }
  }, [paymentModes, paymentModesLoading, selectedProfile, isHospitalPharmacy]);

  // Handle payment modes error
  useEffect(() => {
    if (paymentModesError && !isHospitalPharmacy) {
      setError(paymentModesError);
    }
  }, [paymentModesError, isHospitalPharmacy]);

  // Update payment method amount
  const updatePaymentAmount = (index: number, amount: number) => {
    if (index < 0 || index >= paymentMethods.length) return;
    setPaymentMethods(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], opening_amount: amount };
      }
      return next;
    });
  };

  // Handle create opening entry
  const handleCreateOpeningEntry = async () => {
    try {
      setStep('creating');
      setError('');

      // Hospital: backend seeds MOP rows at 0 — no opening balances UI needed
      const openingBalance = isHospitalPharmacy
        ? []
        : paymentMethods.map(method => ({
            mode_of_payment: method.mode_of_payment,
            opening_amount: method.opening_amount || 0
          }));
      console.log("Opening balance data:", openingBalance, "Selected profile:", selectedProfile);
      await createOpeningEntry(openingBalance, selectedProfile || undefined);

      // Clear all caches after creating opening entry for fresh start
      clearAllCache();
      console.log("🧹 Cache cleared after creating new opening entry");

      // Clear backend cache as well
      try {
        await fetch('/api/method/klik_pos.api.cache.clear_backend_cache', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          credentials: 'include'
        });
        console.log("✅ Backend cache cleared after creating new opening entry");
      } catch (e) {
        console.warn('⚠️ Failed to clear backend cache after opening entry:', e);
      }

    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('Error creating opening entry:', err);
      setError(err.message || 'Failed to create opening entry');
      setStep('form');
    }
  };

  // Calculate total opening amount
  const totalAmount = paymentMethods.reduce((sum, method) => sum + (method.opening_amount || 0), 0);

  // Handle successful creation
  useEffect(() => {
    if (success && step === 'creating') {
      setStep('success');
      setTimeout(() => {
        // Reload the page to ensure fresh data is loaded
        window.location.reload();
      }, 1500);
    }
  }, [success, step]);

  // Handle creation error
  useEffect(() => {
    if (createError && step === 'creating') {
      setError(createError);
      setStep('form');
    }
  }, [createError, step]);

  // Initialize when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('form');
      setError('');
      setSelectedProfile('');
      setPaymentMethods([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Determine if we're currently loading payment modes
  const isLoadingPaymentModes = !isHospitalPharmacy && selectedProfile && paymentModesLoading;
  const canStartSession =
    !!selectedProfile &&
    !profilesLoading &&
    !isCreating &&
    (isHospitalPharmacy || (!isLoadingPaymentModes && paymentMethods.length > 0));

  return (
    <div className="fixed inset-0 bg-beveren-300 bg-opacity-10 flex items-center justify-center z-50 p-4">
<div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-hidden">        {/* Header */}
        <div className="bg-beveren-600 text-white px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">POS Opening Entry</h2>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition-colors"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 relative">
          {step === 'form' && (
            <div className="space-y-6">
              {/* POS Profile Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  POS Profile
                </label>
                <PosProfileSelect
                  profiles={posProfiles || []}
                  value={selectedProfile}
                  onChange={handleProfileChange}
                  disabled={!!isLoadingPaymentModes}
                  loading={!!profilesLoading}
                />
                {isHospitalPharmacy && selectedProfile && (
                  <p className="mt-2 text-xs text-slate-500">
                    Hospital pharmacy — opening balances are not required.
                  </p>
                )}
              </div>

              {/* Payment Methods Loading State */}
              {isLoadingPaymentModes && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <p className="text-sm text-gray-600">Loading payment methods...</p>
                </div>
              )}

              {/* Payment Methods — hidden for hospital pharmacy */}
              {!isHospitalPharmacy && !isLoadingPaymentModes && paymentMethods.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Opening Balances
                  </label>
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {paymentMethods.map((method, index) => (
                      <div key={method.mode_of_payment} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                        {getPaymentIcon(method.type)}
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900">
                            {method.mode_of_payment}
                          </div>
                          <div className="text-xs text-gray-500">
                            {method.type}
                          </div>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={method.opening_amount || ''}
                          onChange={(e) => updatePaymentAmount(index, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-right bg-white dark:bg-white text-gray-900 dark:text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="0.00"
                          disabled={profilesLoading}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <div className="flex justify-between items-center font-semibold">
                      <span>Total Opening Balance:</span>
                      <span className="text-green-600">
                        {formatCurrency(totalAmount, posDetails?.currency || 'USD')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>{error}</div>
                </div>
              )}

              {/* Actions */}
              <div className="flex space-x-3 pt-4">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-red-600 bg-white border border-red-500 rounded-md hover:bg-red-50 transition-colors disabled:border-gray-300 disabled:text-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed"
                  disabled={!!profilesLoading || !!isCreating || !!isLoadingPaymentModes}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateOpeningEntry}
                  disabled={!canStartSession}
                  className="flex-1 px-4 py-2 bg-white border border-beveren-600 text-beveren-700 rounded-md hover:bg-beveren-50 transition-colors disabled:border-gray-300 disabled:text-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed"
                >
                  {profilesLoading ? 'Loading...' :
                   isCreating ? 'Creating...' :
                   isLoadingPaymentModes ? 'Loading...' :
                   'Start POS Session'}
                </button>
              </div>
            </div>
          )}

          {step === 'creating' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Creating Opening Entry
              </h3>
              <p className="text-gray-600">
                Please wait while we set up your POS session...
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                POS Session Started!
              </h3>
              <p className="text-gray-600 mb-4">
                Opening entry created successfully. Redirecting to POS...
              </p>
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600 mx-auto"></div>
            </div>
          )}

          {/* Loading overlay for profile loading */}
          {profilesLoading && step === 'form' && !isLoadingPaymentModes && (
            <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default POSOpeningModal;
