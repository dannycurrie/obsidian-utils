export type MetricType = 'cumulative' | 'timed' | 'average' | 'checklist';

export type Period = {
  start: string;
  end: string;
  partial: boolean;
  entryCount: number;
  value: number | null;
  total?: number;
  items?: { label: string; checked: boolean }[];
};

export type Metric = {
  id: string;
  name: string;
  type: MetricType;
  timeframe: 'weekly' | 'monthly';
  source: string;
  unit: string | null;
  periods: Period[];
};

export type MetricsResponse = {
  from: string;
  to: string;
  timezone: string;
  metrics: Metric[];
};

export async function fetchMetrics(options: {
  baseUrl: string;
  token: string;
  from: string;
  to: string;
}): Promise<MetricsResponse> {
  const url = new URL('/v1/metrics', options.baseUrl);
  url.searchParams.set('from', options.from);
  url.searchParams.set('to', options.to);
  url.searchParams.set('granularity', 'day');

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${options.token}` } });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).message;
    throw new Error(`Could not reach the tracker API at ${url.origin} (${cause})`);
  }

  if (response.status === 401) {
    throw new Error('Tracker API rejected the token (401); check the Keychain item or WEEK_REVIEW_TOKEN');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const detail = body?.error?.message ? `: ${body.error.message}` : '';
    throw new Error(`Tracker API returned ${response.status}${detail}`);
  }
  return (await response.json()) as MetricsResponse;
}
