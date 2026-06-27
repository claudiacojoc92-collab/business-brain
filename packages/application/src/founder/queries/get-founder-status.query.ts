import type { Query } from '../../shared/query-bus';
import type { FounderStatus } from '@bb/shared';
import type { NotificationChannel } from '@bb/domain';

export interface GetFounderStatusQuery extends Query {
  readonly type: 'GetFounderStatus';
  readonly founderId: string;
}

export interface FounderStatusDTO {
  founderId: string;
  status: FounderStatus;
  name: string;
  businessName: string;
  timezone: string;
  notificationChannel: NotificationChannel;
  autoApproveOnWindowClose: boolean;
  approvalWindowHours: number;
  registeredAt: Date;
  activatedAt: Date | null;
  pausedAt: Date | null;
}
