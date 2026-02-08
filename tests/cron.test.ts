import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node-cron
const mockSchedule = vi.fn();
const mockValidate = vi.fn();
const mockStop = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: any[]) => {
      mockSchedule(...args);
      return { stop: mockStop };
    },
    validate: (...args: any[]) => mockValidate(...args),
  },
}));

// Mock agent processMessage
vi.mock('../src/agent.js', () => ({
  processMessage: vi.fn().mockResolvedValue({ content: 'Done', shouldRemember: undefined, taskAdded: undefined }),
}));

// Mock logging
vi.mock('../src/logging.js', () => ({
  getLogger: () => ({
    logCron: vi.fn(),
    logError: vi.fn(),
  }),
}));

import {
  startCronTasks,
  stopCronTasks,
  getActiveCronTasks,
  getCronTaskCount,
  addCronTask,
  removeCronTask,
  reloadCronTasks,
} from '../src/cron.js';

describe('Cron Task Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockReturnValue(true);
    stopCronTasks(); // Clean state
  });

  afterEach(() => {
    stopCronTasks();
  });

  describe('startCronTasks', () => {
    it('should schedule enabled tasks', () => {
      startCronTasks([
        { schedule: '*/5 * * * *', task: 'Check heartbeat' },
        { schedule: '0 9 * * *', task: 'Morning greeting' },
      ]);

      expect(mockSchedule).toHaveBeenCalledTimes(2);
      expect(getActiveCronTasks()).toHaveLength(2);
    });

    it('should skip disabled tasks', () => {
      startCronTasks([
        { schedule: '*/5 * * * *', task: 'Active task' },
        { schedule: '0 9 * * *', task: 'Disabled task', enabled: false },
      ]);

      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(getActiveCronTasks()).toHaveLength(1);
    });

    it('should skip invalid cron expressions', () => {
      mockValidate.mockReturnValueOnce(true).mockReturnValueOnce(false);

      startCronTasks([
        { schedule: '*/5 * * * *', task: 'Valid' },
        { schedule: 'invalid', task: 'Invalid' },
      ]);

      expect(getActiveCronTasks()).toHaveLength(1);
    });

    it('should stop existing tasks before starting new ones', () => {
      startCronTasks([{ schedule: '*/5 * * * *', task: 'First' }]);
      expect(getCronTaskCount()).toBe(1);

      startCronTasks([
        { schedule: '*/10 * * * *', task: 'Second' },
        { schedule: '*/15 * * * *', task: 'Third' },
      ]);

      expect(mockStop).toHaveBeenCalled();
      expect(getCronTaskCount()).toBe(2);
    });
  });

  describe('addCronTask', () => {
    it('should add a new task', () => {
      const result = addCronTask({ schedule: '*/5 * * * *', task: 'New task' });
      expect(result.success).toBe(true);
      expect(getCronTaskCount()).toBe(1);
    });

    it('should reject disabled tasks', () => {
      const result = addCronTask({ schedule: '*/5 * * * *', task: 'Disabled', enabled: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should reject invalid schedule', () => {
      mockValidate.mockReturnValueOnce(false);
      const result = addCronTask({ schedule: 'bad', task: 'Test' });
      expect(result.success).toBe(false);
    });

    it('should prevent duplicate tasks', () => {
      addCronTask({ schedule: '*/5 * * * *', task: 'Task' });
      const result = addCronTask({ schedule: '*/5 * * * *', task: 'Task' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('removeCronTask', () => {
    it('should remove task by index', () => {
      addCronTask({ schedule: '*/5 * * * *', task: 'Task 1' });
      addCronTask({ schedule: '*/10 * * * *', task: 'Task 2' });

      const result = removeCronTask(0);
      expect(result.success).toBe(true);
      expect(getCronTaskCount()).toBe(1);
    });

    it('should return error for invalid index', () => {
      const result = removeCronTask(99);
      expect(result.success).toBe(false);
    });
  });

  describe('reloadCronTasks', () => {
    it('should add new and remove old tasks', () => {
      addCronTask({ schedule: '*/5 * * * *', task: 'Keep' });
      addCronTask({ schedule: '*/10 * * * *', task: 'Remove' });

      const result = reloadCronTasks([
        { schedule: '*/5 * * * *', task: 'Keep' },
        { schedule: '*/15 * * * *', task: 'New' },
      ]);

      expect(result.unchanged).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.added).toBe(1);
    });

    it('should skip disabled tasks in reload', () => {
      const result = reloadCronTasks([
        { schedule: '*/5 * * * *', task: 'Active' },
        { schedule: '*/10 * * * *', task: 'Disabled', enabled: false },
      ]);

      expect(result.added).toBe(1);
      expect(getCronTaskCount()).toBe(1);
    });
  });
});
