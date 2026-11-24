export type DioceseType = 'ARCHDIOCESE' | 'DIOCESE';

export type ParishCategory =
  | 'CATHEDRAL_PARISH'
  | 'PARISH'
  | 'QUASI_PARISH'
  | 'OTHER';

export type VerificationStatus =
  | 'VERIFIED'
  | 'SECONDARY_SOURCE'
  | 'TO_CONFIRM';

export type DirectoryCompleteness = 'COMPLETE' | 'PARTIAL' | 'MINIMAL';

export type ParishRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ParishEntry {
  id: string;
  name: string;
  aliases?: string[];
  location: string;
  pastoralSectorOrDeanery: string | null;
  category: ParishCategory;
  verificationStatus: VerificationStatus;
  sourceUrl: string;
  lastVerifiedAt: string;
}

export interface DioceseEntry {
  id: string;
  name: string;
  type: DioceseType;
  officialWebsite: string | null;
  estimatedParishCount: number | null;
  directoryCompleteness: DirectoryCompleteness;
  coverageNote: string;
  parishes: ParishEntry[];
}

export interface ProvinceEntry {
  id: string;
  name: string;
  dioceses: DioceseEntry[];
}

export interface CatholicDirectoryDataset {
  metadata: {
    country: string;
    lastUpdated: string;
    sourcePolicy: string;
    totalProvinces: number;
    totalDioceses: number;
  };
  provinces: ProvinceEntry[];
}

export interface ParishRequestRecord {
  id: string;
  provinceId: string;
  dioceseId: string;
  parishName: string;
  userId: string | null;
  status: ParishRequestStatus;
  submittedAt: string;
  adminDecisionNote: string | null;
  decidedAt: string | null;
}

export interface EcclesiasticalRegistration {
  provinceId: string;
  dioceseId: string;
  parishId: string | null;
  parishNameSnapshot: string | null;
  parishRequestId?: string;
}
