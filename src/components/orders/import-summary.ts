export interface BulkImportJson {
  success: boolean;
  data?: { imported: number; skipped: number; total: number; voided?: number };
  error?: string;
}

export interface ChannelImportResult {
  channel: string;
  success: boolean;
  imported: number;
  skipped: number;
  total: number;
  voided: number;
  error?: string;
}

export interface ImportSummary {
  channels: ChannelImportResult[];
  totalImported: number;
  totalVoided: number;
  hasError: boolean;
}

export function buildImportSummary(
  results: { channel: string; json: BulkImportJson }[],
): ImportSummary {
  const channels: ChannelImportResult[] = results.map(({ channel, json }) => {
    if (json.success) {
      return {
        channel,
        success: true,
        imported: json.data?.imported ?? 0,
        skipped: json.data?.skipped ?? 0,
        total: json.data?.total ?? 0,
        voided: json.data?.voided ?? 0,
      };
    }
    return {
      channel,
      success: false,
      imported: 0,
      skipped: 0,
      total: 0,
      voided: 0,
      error: json.error ?? '실패',
    };
  });

  return {
    channels,
    totalImported: channels.reduce((sum, c) => sum + c.imported, 0),
    totalVoided: channels.reduce((sum, c) => sum + c.voided, 0),
    hasError: channels.some((c) => !c.success),
  };
}
