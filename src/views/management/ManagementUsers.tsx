import React from 'react';
import { LedgerEntry, User, UserStatsSummary } from '../../types';
import { Loader2, RefreshCw, Users } from 'lucide-react';

interface ManagementUsersProps {
  currentUser: User;
  users: User[];
  filteredUsers: User[];
  userStats: Record<string, UserStatsSummary>;
  userDrafts: Record<string, Partial<User>>;
  expandedUserId: string | null;
  setExpandedUserId: (id: string | null) => void;
  userLedgers: Record<string, LedgerEntry[]>;
  ledgerLoading: Record<string, boolean>;
  ledgerErrors: Record<string, string | null>;
  userStatsLoading: Record<string, boolean>;
  userFilter: string;
  setUserFilter: (filter: string) => void;
  isUsersLoading: boolean;
  usersError: string | null;
  refreshUsers: () => void;
  handleUserDraftChange: (userId: string, updates: Partial<User>) => void;
  fetchUserLedger: (userId: string) => void;
  toggleUserDetails: (user: User) => void;
  saveUserDraft: (userId: string) => void;
  apiDeleteUser: (userId: string) => void;
  allowPlatinumTier: boolean;
  allowGreenTier: boolean;
  fmtTime: (iso?: string) => string;
  fmtDelta: (value: number) => string;
  getTierStyles: (tier: string) => string;
  isNewSignupWithBonus: (user: User) => boolean;
}

const ManagementUsers: React.FC<ManagementUsersProps> = ({
  currentUser,
  users,
  filteredUsers,
  userStats,
  userDrafts,
  expandedUserId,
  setExpandedUserId,
  userLedgers,
  ledgerLoading,
  ledgerErrors,
  userStatsLoading,
  userFilter,
  setUserFilter,
  isUsersLoading,
  usersError,
  refreshUsers,
  handleUserDraftChange,
  fetchUserLedger,
  toggleUserDetails,
  saveUserDraft,
  apiDeleteUser,
  allowPlatinumTier,
  allowGreenTier,
  fmtTime,
  fmtDelta,
  getTierStyles,
  isNewSignupWithBonus
}) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black uppercase text-white tracking-widest">
            Users
          </h2>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-2">
            accounts • loyalty • credits • tier
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <input
            id="userFilter"
            name="userFilter"
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            placeholder="Filter by username, tier, role..."
            className="flex-1 md:w-64 bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
          />
          <button
            onClick={refreshUsers}
            className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 transition-all flex items-center justify-center gap-3"
          >
            {isUsersLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {usersError && (
        <div className="bg-ninpo-card p-6 rounded-[2rem] border border-ninpo-red/20 text-[11px] text-ninpo-red">
          {usersError}
        </div>
      )}

      {isUsersLoading && users.length === 0 ? (
        <div className="p-12 bg-ninpo-card rounded-[2.5rem] border border-white/5 text-center text-[10px] text-slate-500 uppercase tracking-widest">
          Loading users...
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="p-20 bg-ninpo-card rounded-[3rem] border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
          <Users className="w-12 h-12 text-slate-800 mb-4" />
          <p className="text-[10px] uppercase font-black text-slate-700 tracking-[0.4em]">
            No Users Found
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {filteredUsers.map(u => {
            const stats = userStats[u.id];
            const draft = userDrafts[u.id] || {};
            const isExpanded = expandedUserId === u.id;
            const ledgerEntries = userLedgers[u.id] || [];
            const ledgerBusy = ledgerLoading[u.id];
            const ledgerError = ledgerErrors[u.id];
            const statsLoading = userStatsLoading[u.id];
            const tierKey = (u.membershipTier || 'COMMON').toString().toUpperCase();
            const tierLabel =
              tierKey === 'NONE'
                ? 'COMMON'
                : tierKey === 'PLATINUM'
                ? 'SECRET PLATINUM'
                : tierKey;
            const showSignupBonus = isNewSignupWithBonus(u);
            const orderCountLabel = statsLoading ? '...' : stats ? stats.orderCount : '—';
            const totalSpendLabel = statsLoading
              ? 'Loading...'
              : stats
              ? `$${Number(stats.totalSpend || 0).toFixed(2)}`
              : '—';
            const lastOrderLabel = statsLoading
              ? 'Loading...'
              : stats?.lastOrderAt
              ? fmtTime(stats.lastOrderAt)
              : '—';

            return (
              <div
                key={u.id}
                className="group bg-ninpo-card p-6 rounded-[2.5rem] border border-white/5 space-y-4 transition-all hover:border-white/10"
                onClick={() => toggleUserDetails(u)}
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 flex flex-wrap items-center gap-2">
                      <span>USER: {u.username || u.name || u.id}</span>
                      <span
                        className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-[0.3em] ${getTierStyles(
                          tierKey === 'NONE' ? 'COMMON' : tierKey
                        )}`}
                      >
                        {tierLabel}
                      </span>
                    </p>
                    <p className="text-white font-black text-lg uppercase mt-1">
                      {tierLabel} STATUS
                    </p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">
                      Role: {u.role || 'CUSTOMER'}
                    </p>
                    {showSignupBonus && (
                      <p className="text-[10px] text-ninpo-lime font-bold uppercase tracking-widest mt-2">
                        Signup bonus awarded
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                      Credits: ${Number(u.creditBalance || 0).toFixed(2)}
                    </div>
                    <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                      Points: {Number(u.loyaltyPoints || 0)}
                    </div>
                    <div className="px-4 py-2 rounded-xl text-[9px] font-black uppercase border tracking-widest text-white/80 border-white/10 bg-white/5">
                      Orders: {orderCountLabel}
                    </div>
                  </div>
                </div>

                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    isExpanded
                      ? 'max-h-[520px] opacity-100'
                      : 'max-h-0 opacity-0 group-hover:max-h-[520px] group-hover:opacity-100'
                  }`}
                >
                  <div className="border-t border-white/5 pt-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        Summary
                      </p>
                      <div className="space-y-2 text-[11px] text-slate-400">
                        <p>
                          Total Spend:{' '}
                          <span className="text-slate-200 font-bold">{totalSpendLabel}</span>
                        </p>
                        <p>
                          Last Order:{' '}
                          <span className="text-slate-200 font-bold">{lastOrderLabel}</span>
                        </p>
                        <p>
                          Joined:{' '}
                          <span className="text-slate-200 font-bold">{fmtTime(u.createdAt)}</span>
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                        Manage
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <input
                          id={`userCreditBalance-${u.id}`}
                          name={`userCreditBalance-${u.id}`}
                          type="number"
                          className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                          placeholder="Credits"
                          value={draft.creditBalance ?? u.creditBalance ?? 0}
                          onClick={e => e.stopPropagation()}
                          onChange={e =>
                            handleUserDraftChange(u.id, {
                              creditBalance: Number(e.target.value)
                            })
                          }
                        />
                        <input
                          id={`userLoyaltyPoints-${u.id}`}
                          name={`userLoyaltyPoints-${u.id}`}
                          type="number"
                          className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                          placeholder="Points"
                          value={draft.loyaltyPoints ?? u.loyaltyPoints ?? 0}
                          onClick={e => e.stopPropagation()}
                          onChange={e =>
                            handleUserDraftChange(u.id, {
                              loyaltyPoints: Number(e.target.value)
                            })
                          }
                        />
                        <select
                          className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-[11px] text-white"
                          value={(draft.membershipTier ?? u.membershipTier ?? 'COMMON').toString()}
                          onClick={e => e.stopPropagation()}
                          disabled={!allowPlatinumTier && u.membershipTier === 'PLATINUM'}
                          onChange={e =>
                            handleUserDraftChange(u.id, {
                              membershipTier: e.target.value as any
                            })
                          }
                        >
                          <option value="COMMON">Common</option>
                          <option value="BRONZE">Bronze</option>
                          <option value="SILVER">Silver</option>
                          <option value="GOLD">Gold</option>
                          {(allowPlatinumTier || u.membershipTier === 'PLATINUM') && (
                            <option value="PLATINUM" disabled={!allowPlatinumTier}>
                              Secret Platinum
                            </option>
                          )}
                          {(allowGreenTier || u.membershipTier === 'GREEN') && (
                            <option value="GREEN" disabled={!allowGreenTier}>
                              Green
                            </option>
                          )}
                        </select>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            saveUserDraft(u.id);
                          }}
                          className="px-6 py-3 rounded-2xl bg-ninpo-lime text-ninpo-black text-[10px] font-black uppercase tracking-widest"
                        >
                          Save
                        </button>
                        {u.role !== 'OWNER' && u.id !== currentUser?.id && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              apiDeleteUser(u.id);
                            }}
                            className="px-6 py-3 rounded-2xl bg-ninpo-red text-white text-[10px] font-black uppercase tracking-widest"
                          >
                            Delete
                          </button>
                        )}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setExpandedUserId(prev => (prev === u.id ? null : u.id));
                          }}
                          className="px-6 py-3 rounded-2xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          {isExpanded ? 'Collapse' : 'Pin Details'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                          Ledger
                        </p>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            fetchUserLedger(u.id);
                          }}
                          className="px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-widest text-white/70 hover:text-white"
                        >
                          Refresh
                        </button>
                      </div>

                      {ledgerError && (
                        <div className="text-[10px] text-ninpo-red">{ledgerError}</div>
                      )}

                      {ledgerBusy ? (
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                          Loading ledger...
                        </div>
                      ) : ledgerEntries.length === 0 ? (
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                          No ledger entries yet.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-44 overflow-auto pr-1">
                          {ledgerEntries.map(entry => (
                            <div
                              key={entry.id}
                              className="border border-white/5 rounded-2xl px-3 py-2 bg-black/30"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-200 font-bold">
                                  {entry.reason || 'UPDATE'}
                                </span>
                                <span
                                  className={
                                    Number(entry.delta || 0) >= 0
                                      ? 'text-ninpo-lime font-bold'
                                      : 'text-ninpo-red font-bold'
                                  }
                                >
                                  {fmtDelta(entry.delta)}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500">
                                {fmtTime(entry.createdAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManagementUsers;
