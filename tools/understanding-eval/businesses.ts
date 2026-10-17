/**
 * The seven businesses of the understanding eval (2026-10-17): real production businesses, chosen across type and
 * language. `oldSnapshotId` = the stored understanding from before the 10-15 regression to compare against (E3 where
 * one exists, else the earliest E1). Fixtures are exported read-only from production into the git-ignored
 * .eval/understanding/fixtures/<slug>.json; their content hashes are in manifest.json.
 */
export interface EvalBusiness {
  readonly slug: string;
  readonly businessId: string;
  readonly kind: string;
  readonly language: 'ro' | 'en' | 'de';
  readonly oldSnapshotId: string;
  readonly oldEra: 'E1' | 'E3';
}

export const BUSINESSES: readonly EvalBusiness[] = [
  { slug: 'bodymove', businessId: '01M549W56STYH2FD536GNP2KD4', kind: 'movement + recovery studio', language: 'ro', oldSnapshotId: '01M4SXNZWZFBKEWWTNDTJDYR2N', oldEra: 'E3' },
  { slug: 'qufi', businessId: '01M4SCDKSZBM2AVC65HNWBY489', kind: 'B2B fintech infrastructure', language: 'en', oldSnapshotId: '01M4SXYMZV2J9S18C78ZJC6JG0', oldEra: 'E3' },
  { slug: 'businessbrain', businessId: '01M2C94RMTGJBZGYHBBEXRGXEH', kind: 'SaaS for founders (website + Instagram)', language: 'en', oldSnapshotId: '01M4SXTHH4PZ5P6S3WC15YB19E', oldEra: 'E3' },
  { slug: 'lfg', businessId: '01M4VYF9TXVPYXBX5PR1JMGYM8', kind: 'German-language business', language: 'de', oldSnapshotId: '01M4VZBWGSGSH34290EEHTXX6G', oldEra: 'E3' },
  { slug: 'immexpert', businessId: '01M4094ZWGE0YJNTKJGQ7EMVMQ', kind: 'services (website + founder document)', language: 'ro', oldSnapshotId: '01M40996HJTCGXWP1VN802Q0M4', oldEra: 'E1' },
  { slug: 'eastfork', businessId: '01M27XGMW7X2GJF5D0WR0T96AD', kind: 'ecommerce ceramics', language: 'en', oldSnapshotId: '01M27XKA3YN9BX3NJA4S769FXZ', oldEra: 'E1' },
  { slug: 'basecamp', businessId: '01M27XANWJJN2H5JGQKD2G9YA2', kind: 'B2B SaaS', language: 'en', oldSnapshotId: '01M27XD7P7YKH6ZWBGM6VBH0P2', oldEra: 'E1' },
];
