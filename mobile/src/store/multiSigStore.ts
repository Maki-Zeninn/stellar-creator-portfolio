import { create } from 'zustand';
import type { MultiSigState, MultiSigTask, MultiSigSigner } from '../types';
import { authenticateBiometric } from '../services/BiometricAuthService';

const createSigner = (id: string, name: string, status: MultiSigSigner['status']): MultiSigSigner => ({
  id,
  name,
  role: id === 'initiator' ? 'Initiator' : 'Approver',
  status,
});

const initialTasks: MultiSigTask[] = [
  {
    id: 'ms-001',
    title: 'Creator royalty disbursement',
    amount: '1,800 XLM',
    description: 'Multi-sig approval required for high-value creator payout.',
    status: 'pending',
    signers: [
      createSigner('initiator', 'Amelia', 'approved'),
      createSigner('signer-1', 'Priya', 'pending'),
      createSigner('signer-2', 'Jaxon', 'pending'),
    ],
    queuedApprovals: [],
  },
];

export const useMultiSigStore = create<MultiSigState>((set) => ({
  tasks: initialTasks,

  // Approval requires a real, verified biometric confirmation from the signer's
  // own device — there is no timer-based or otherwise unconditional path to
  // 'approved'. If the confirmation fails or is cancelled, the signer is left
  // 'pending' and the caller's awaited promise rejects so the UI can surface
  // the failure.
  queueApproval: async (taskId, signerId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id !== taskId
          ? task
          : {
              ...task,
              queuedApprovals: task.queuedApprovals.includes(signerId)
                ? task.queuedApprovals
                : [...task.queuedApprovals, signerId],
            },
      ),
    }));

    try {
      const result = await authenticateBiometric();
      if (!result.success) {
        throw new Error(result.error ?? 'Biometric confirmation failed');
      }
      useMultiSigStore.getState().approveSigner(taskId, signerId);
    } finally {
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id !== taskId
            ? task
            : {
                ...task,
                queuedApprovals: task.queuedApprovals.filter((id) => id !== signerId),
              },
        ),
      }));
    }
  },

  // Internal: flips a signer to 'approved'. Only ever called after
  // `queueApproval` has verified a real biometric confirmation above —
  // never call this directly from UI code.
  approveSigner: (taskId, signerId) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        const signers = task.signers.map((signer) =>
          signer.id !== signerId
            ? signer
            : {
                ...signer,
                status: 'approved' as const,
              },
        );

        const pending = signers.some((signer) => signer.status === 'pending');
        return {
          ...task,
          signers,
          status: pending ? 'pending' : 'approved',
        };
      }),
    }));
  },
}));
