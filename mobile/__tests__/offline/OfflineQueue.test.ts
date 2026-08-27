import * as OfflineQueue from '../../src/offline/OfflineQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Smoke test for OfflineQueue — verifies initialization, enqueue/dequeue,
 * and retry behavior under basic conditions.
 */
describe('OfflineQueue', () => {
  beforeEach(async () => {
    // Clear AsyncStorage before each test to avoid state pollution
    await AsyncStorage.clear();
  });

  describe('happy path — enqueue and process', () => {
    it('initializes successfully and enqueues a trivial request', async () => {
      const operation = {
        type: 'create' as const,
        endpoint: '/api/test',
        payload: { test: true },
      };

      await OfflineQueue.enqueue(operation);
      const pending = await OfflineQueue.getPendingOps();

      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        ...operation,
        retries: 0,
      });
      expect(pending[0].id).toBeDefined();
      expect(pending[0].createdAt).toBeDefined();
    });

    it('dequeues a successfully processed operation', async () => {
      const operation = {
        type: 'update' as const,
        endpoint: '/api/test/123',
        payload: { name: 'updated' },
      };

      await OfflineQueue.enqueue(operation);
      const [enqueued] = await OfflineQueue.getPendingOps();
      expect(enqueued).toBeDefined();

      await OfflineQueue.dequeue(enqueued.id);
      const remaining = await OfflineQueue.getPendingOps();

      expect(remaining).toHaveLength(0);
    });
  });

  describe('edge case — offline enqueueing', () => {
    it('enqueues multiple operations and maintains order', async () => {
      const ops = [
        { type: 'create' as const, endpoint: '/api/users', payload: { name: 'Alice' } },
        { type: 'update' as const, endpoint: '/api/users/1', payload: { age: 30 } },
        { type: 'delete' as const, endpoint: '/api/users/2' },
      ];

      for (const op of ops) {
        await OfflineQueue.enqueue(op);
      }

      const pending = await OfflineQueue.getPendingOps();
      expect(pending).toHaveLength(3);
      expect(pending[0].endpoint).toBe('/api/users');
      expect(pending[1].endpoint).toBe('/api/users/1');
      expect(pending[2].endpoint).toBe('/api/users/2');
    });
  });

  describe('edge case — retry behavior with backoff', () => {
    it('increments retry count and schedules next retry', async () => {
      const operation = {
        type: 'create' as const,
        endpoint: '/api/fail',
        payload: { attempt: 1 },
      };

      await OfflineQueue.enqueue(operation);
      const [op] = await OfflineQueue.getPendingOps();

      // First failure
      const movedToDLQ = await OfflineQueue.markRetry(op.id);
      expect(movedToDLQ).toBe(false); // Should not move to DLQ yet

      const [updated] = await OfflineQueue.getPendingOps();
      expect(updated.retries).toBe(1);
      expect(updated.nextRetryAt).toBeGreaterThan(Date.now()); // Scheduled in future
    });

    it('moves operation to dead-letter queue after max retries', async () => {
      const operation = {
        type: 'create' as const,
        endpoint: '/api/permanent-fail',
      };

      await OfflineQueue.enqueue(operation);
      const [op] = await OfflineQueue.getPendingOps();

      // Simulate 5 failed retry attempts
      for (let i = 0; i < 5; i++) {
        const movedToDLQ = await OfflineQueue.markRetry(op.id);
        if (i < 4) {
          expect(movedToDLQ).toBe(false);
        } else {
          expect(movedToDLQ).toBe(true); // 5th attempt moves to DLQ
        }
      }

      const pending = await OfflineQueue.getPendingOps();
      const dlq = await OfflineQueue.getDeadLetterOps();

      expect(pending).toHaveLength(0);
      expect(dlq).toHaveLength(1);
      expect(dlq[0].retries).toBe(5);
    });
  });

  describe('edge case — dead-letter queue management', () => {
    it('requeues a dead-lettered operation for retry', async () => {
      const operation = {
        type: 'delete' as const,
        endpoint: '/api/delete-user',
      };

      // Enqueue and move to DLQ
      await OfflineQueue.enqueue(operation);
      const [op] = await OfflineQueue.getPendingOps();
      for (let i = 0; i < 5; i++) {
        await OfflineQueue.markRetry(op.id);
      }

      // Verify it's in DLQ
      const dlqBefore = await OfflineQueue.getDeadLetterOps();
      expect(dlqBefore).toHaveLength(1);

      // Requeue it
      await OfflineQueue.requeueFromDead(dlqBefore[0].id);

      const dlqAfter = await OfflineQueue.getDeadLetterOps();
      const pending = await OfflineQueue.getPendingOps();

      expect(dlqAfter).toHaveLength(0);
      expect(pending).toHaveLength(1);
      expect(pending[0].retries).toBe(0); // Reset retry count
    });
  });

  describe('queue metrics', () => {
    it('reports correct pending and dead-letter counts', async () => {
      const ops = [
        { type: 'create' as const, endpoint: '/api/1' },
        { type: 'update' as const, endpoint: '/api/2' },
      ];

      for (const op of ops) {
        await OfflineQueue.enqueue(op);
      }

      expect(await OfflineQueue.pendingCount()).toBe(2);
      expect(await OfflineQueue.deadLetterCount()).toBe(0);

      const [first] = await OfflineQueue.getPendingOps();
      for (let i = 0; i < 5; i++) {
        await OfflineQueue.markRetry(first.id);
      }

      expect(await OfflineQueue.pendingCount()).toBe(1);
      expect(await OfflineQueue.deadLetterCount()).toBe(1);
    });
  });
});
