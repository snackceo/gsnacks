import React from 'react';
import { AppSettings } from '../../types';

interface ManagementSettingsProps {
  settingsDraft: AppSettings;
  setSettingsDraft: (draft: AppSettings) => void;
  settingsDirty: boolean;
  setSettingsDirty: (dirty: boolean) => void;
  isSavingSettings: boolean;
  setIsSavingSettings: (saving: boolean) => void;
  settingsError: string | null;
  setSettingsError: (error: string | null) => void;
  settingsSaved: boolean;
  setSettingsSaved: (saved: boolean) => void;
  updateSettingsDraft: (updates: Partial<AppSettings>) => void;
  saveSettings: () => void;
}

const ManagementSettings: React.FC<ManagementSettingsProps> = ({
  settingsDraft,
  setSettingsDraft,
  settingsDirty,
  setSettingsDirty,
  isSavingSettings,
  setIsSavingSettings,
  settingsError,
  setSettingsError,
  settingsSaved,
  setSettingsSaved,
  updateSettingsDraft,
  saveSettings
}) => {
  return (
    <form
      className="space-y-6 max-w-2xl mx-auto bg-ninpo-card p-8 rounded-2xl border border-white/10"
      onSubmit={e => {
        e.preventDefault();
        saveSettings();
      }}
    >
      <h2 className="text-xl font-bold mb-4">App Settings</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          Route Fee
          <input type="number" step="0.01" className="input" value={settingsDraft.routeFee}
            onChange={e => updateSettingsDraft({ routeFee: Number(e.target.value) })} />
        </label>
        <label>
          Delivery Fee
          <input type="number" step="0.01" className="input" value={settingsDraft.deliveryFee}
            onChange={e => updateSettingsDraft({ deliveryFee: Number(e.target.value) })} />
        </label>
        <label>
          Referral Bonus
          <input type="number" step="0.01" className="input" value={settingsDraft.referralBonus}
            onChange={e => updateSettingsDraft({ referralBonus: Number(e.target.value) })} />
        </label>
        <label>
          Pickup Only Multiplier
          <input type="number" step="0.01" className="input" value={settingsDraft.pickupOnlyMultiplier}
            onChange={e => updateSettingsDraft({ pickupOnlyMultiplier: Number(e.target.value) })} />
        </label>
        <label>
          Distance Included Miles
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceIncludedMiles}
            onChange={e => updateSettingsDraft({ distanceIncludedMiles: Number(e.target.value) })} />
        </label>
        <label>
          Distance Band 1 Max Miles
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceBand1MaxMiles}
            onChange={e => updateSettingsDraft({ distanceBand1MaxMiles: Number(e.target.value) })} />
        </label>
        <label>
          Distance Band 2 Max Miles
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceBand2MaxMiles}
            onChange={e => updateSettingsDraft({ distanceBand2MaxMiles: Number(e.target.value) })} />
        </label>
        <label>
          Distance Band 1 Rate
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceBand1Rate}
            onChange={e => updateSettingsDraft({ distanceBand1Rate: Number(e.target.value) })} />
        </label>
        <label>
          Distance Band 2 Rate
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceBand2Rate}
            onChange={e => updateSettingsDraft({ distanceBand2Rate: Number(e.target.value) })} />
        </label>
        <label>
          Distance Band 3 Rate
          <input type="number" step="0.01" className="input" value={settingsDraft.distanceBand3Rate}
            onChange={e => updateSettingsDraft({ distanceBand3Rate: Number(e.target.value) })} />
        </label>
        <label>
          Hub Latitude
          <input type="number" step="0.000001" className="input" value={settingsDraft.hubLat ?? ''}
            onChange={e => updateSettingsDraft({ hubLat: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label>
          Hub Longitude
          <input type="number" step="0.000001" className="input" value={settingsDraft.hubLng ?? ''}
            onChange={e => updateSettingsDraft({ hubLng: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.maintenanceMode}
            onChange={e => updateSettingsDraft({ maintenanceMode: e.target.checked })} />
          Maintenance Mode
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.requirePhotoForRefunds}
            onChange={e => updateSettingsDraft({ requirePhotoForRefunds: e.target.checked })} />
          Require Photo For Refunds
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.allowGuestCheckout}
            onChange={e => updateSettingsDraft({ allowGuestCheckout: e.target.checked })} />
          Allow Guest Checkout
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.showAdvancedInventoryInsights}
            onChange={e => updateSettingsDraft({ showAdvancedInventoryInsights: e.target.checked })} />
          Show Advanced Inventory Insights
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.allowPlatinumTier}
            onChange={e => updateSettingsDraft({ allowPlatinumTier: e.target.checked })} />
          Allow Platinum Tier
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!settingsDraft.platinumFreeDelivery}
            onChange={e => updateSettingsDraft({ platinumFreeDelivery: e.target.checked })} />
          Platinum Free Delivery
        </label>
      </div>
      {settingsError && <div className="text-red-500 font-bold">{settingsError}</div>}
      {settingsSaved && <div className="text-green-500 font-bold">Settings saved!</div>}
      <button
        type="submit"
        className="bg-ninpo-lime text-ninpo-black font-bold px-6 py-3 rounded-2xl mt-6"
        disabled={isSavingSettings}
      >
        {isSavingSettings ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  );
};

export default ManagementSettings;
