import type { Schedule } from "@zuu/client";
import type { ScheduleLease } from "./schedule-lease";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface ScheduleTimerRegistryOptions {
  lease?: ScheduleLease;
  leaseHeartbeatMs?: number;
  onLeaseAcquired?: () => void;
}

export class ScheduleTimerRegistry {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lease?: ScheduleLease;
  private readonly onLeaseAcquired?: () => void;
  private leaseHeld: boolean;
  private leaseHeartbeatTimer: NodeJS.Timeout | undefined;

  constructor(options: ScheduleTimerRegistryOptions = {}) {
    this.lease = options.lease;
    this.onLeaseAcquired = options.onLeaseAcquired;
    this.leaseHeld = this.lease ? this.lease.acquire() : true;
    if (this.lease) this.startLeaseHeartbeat(options.leaseHeartbeatMs);
  }

  canRunAutomaticTimers() {
    return !this.lease || this.leaseHeld;
  }

  arm(schedule: Schedule, onFire: () => void) {
    this.clear(schedule.id);
    if (!this.canRunAutomaticTimers()) return;
    if (schedule.status !== "active" || !schedule.nextRunAt) return;

    const delay = Math.max(0, Math.min(Date.parse(schedule.nextRunAt) - Date.now(), MAX_TIMER_DELAY_MS));
    const timer = setTimeout(onFire, delay);
    timer.unref?.();
    this.timers.set(schedule.id, timer);
  }

  clear(scheduleId: string) {
    const timer = this.timers.get(scheduleId);
    if (timer) clearTimeout(timer);
    this.timers.delete(scheduleId);
  }

  clearAll() {
    for (const scheduleId of this.timers.keys()) {
      this.clear(scheduleId);
    }
  }

  dispose() {
    this.clearAll();
    if (this.leaseHeartbeatTimer) clearInterval(this.leaseHeartbeatTimer);
    this.leaseHeartbeatTimer = undefined;
    this.lease?.release();
  }

  private startLeaseHeartbeat(heartbeatMs = 5_000) {
    this.leaseHeartbeatTimer = setInterval(() => {
      if (!this.lease) return;
      if (this.leaseHeld) {
        this.leaseHeld = this.lease.heartbeat();
        if (!this.leaseHeld) this.clearAll();
        return;
      }

      this.leaseHeld = this.lease.acquire();
      if (this.leaseHeld) this.onLeaseAcquired?.();
    }, heartbeatMs);
    this.leaseHeartbeatTimer.unref?.();
  }
}
