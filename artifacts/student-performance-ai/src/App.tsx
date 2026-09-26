import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Gauge,
  Info,
  Lightbulb,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  useChat,
  useHealthCheck,
  usePredictPerformance,
  type ChatResult,
  type FeatureImpact,
  type PredictionInput,
  type PredictionResult,
} from '@workspace/api-client-react';

type FormValues = Record<keyof PredictionInput, number | ''>;
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Home() {
  const [formValues, setFormValues] = useState<FormValues>({
    studyHours: '',
    attendance: '',
    internalMarks: '',
    assignmentMarks: '',
    previousStudyHours: '',
    previousMarks: '',
  });
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [latestInput, setLatestInput] = useState<PredictionInput | null>(null);
  const [validationError, setValidationError] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [chatItems, setChatItems] = useState<Array<{ role: 'assistant' | 'student'; text: string }>>([]);
  const [chatError, setChatError] = useState('');
  const predictMutation = usePredictPerformance();
  const chatMutation = useChat();
  const healthQuery = useHealthCheck();

  const fields = useMemo(() => [
    { key: 'studyHours' as const, label: 'Current study hours', hint: 'hours / day', min: 0.5, max: 24, step: 0.5, icon: Clock3 },
    { key: 'attendance' as const, label: 'Attendance', hint: 'percent', min: 0, max: 100, step: 1, icon: BookOpenCheck },
    { key: 'internalMarks' as const, label: 'Internal marks', hint: 'out of 100', min: 0, max: 100, step: 1, icon: Gauge },
    { key: 'assignmentMarks' as const, label: 'Assignment marks', hint: 'out of 100', min: 0, max: 100, step: 1, icon: Check },
    { key: 'previousStudyHours' as const, label: 'Previous study hours', hint: 'hours / day', min: 0.5, max: 24, step: 0.5, icon: Clock3 },
    { key: 'previousMarks' as const, label: 'Previous marks', hint: 'out of 100', min: 0, max: 100, step: 1, icon: Target },
  ], []);

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
    return 'Something went wrong. Please try again.';
  };

  const numericFormValues = () => fields.reduce((values, field) => {
    values[field.key] = Number(formValues[field.key]);
    return values;
  }, {} as PredictionInput);

  const submitPrediction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = fields.find((field) => {
      const value = formValues[field.key];
      return value === '' || !Number.isFinite(Number(value)) || Number(value) < field.min || Number(value) > field.max;
    });
    if (invalid) {
      setValidationError(`${invalid.label} must be between ${invalid.min} and ${invalid.max}.`);
      return;
    }
    setValidationError('');
    predictMutation.mutate({ data: numericFormValues() }, {
      onSuccess: (result: PredictionResult) => {
        setPrediction(result);
        setLatestInput(result.input);
        setChatError('');
      },
    });
  };

  const resetWorkspace = () => {
    setFormValues({
      studyHours: '',
      attendance: '',
      internalMarks: '',
      assignmentMarks: '',
      previousStudyHours: '',
      previousMarks: '',
    });
    setPrediction(null);
    setLatestInput(null);
    setChatItems([]);
    setChatMessage('');
    setValidationError('');
    predictMutation.reset();
    chatMutation.reset();
  };

  const sendChat = (event?: FormEvent<HTMLFormElement>, preset?: string) => {
    event?.preventDefault();
    const message = (preset ?? chatMessage).trim();
    if (!message || chatMutation.isPending) return;
    setChatError('');
    setChatItems((items) => [...items, { role: 'student', text: message }]);
    setChatMessage('');
    chatMutation.mutate({ data: { message, ...(latestInput ? { latestInput } : {}) } }, {
      onSuccess: (result: ChatResult) => {
        setChatItems((items) => [...items, { role: 'assistant', text: result.response }]);
        if (result.predictionResult) {
          setPrediction(result.predictionResult);
          setLatestInput(result.predictionResult.input);
        }
      },
      onError: (error: unknown) => setChatError(getErrorMessage(error)),
    });
  };

  const statusText = healthQuery.isLoading
    ? 'Checking assistant'
    : healthQuery.isError
      ? 'Assistant unavailable'
      : 'Assistant online';

  return (
    <div className="app-grid min-h-[100dvh] bg-background">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1540px]">
        <aside className="hidden w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 px-5 py-6 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Activity className="size-5" strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-display text-[14px] font-bold tracking-tight text-foreground">Student Performance AI</p>
              <p className="text-[10px] font-medium leading-4 text-muted-foreground">Explainable academic support</p>
            </div>
          </div>
          <div className="mt-10 rounded-2xl border border-sidebar-border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-primary">
              <Sparkles className="size-3.5" />
              <span>Today’s workspace</span>
            </div>
            <p className="mt-3 text-sm leading-5 text-muted-foreground">Understand the signal before you decide what to change.</p>
          </div>
          <nav className="mt-8 space-y-2" aria-label="Workspace sections">
            <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-3 text-sm font-semibold text-sidebar-accent-foreground">
              <Gauge className="size-4" />
              Performance check
            </div>
          </nav>
          <div className="mt-auto rounded-2xl border border-sidebar-border bg-background/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-4 text-primary" />
              Private by design
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Use your own indicators. This space is for reflection, not ranking.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-border/70 bg-background/75 px-5 py-4 backdrop-blur-sm sm:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Student performance predictor</p>
              <h1 className="mt-1 max-w-3xl font-display text-lg font-bold tracking-tight text-foreground sm:text-2xl">Explainable AI — Understand Your Prediction</h1>
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block">Explore your indicators, the model’s reasoning, and practical next steps.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex" data-testid="status-assistant">
                <span className={`size-2 rounded-full ${healthQuery.isError ? 'bg-destructive' : 'bg-emerald-500'}`} />
                {statusText}
              </div>
              <button type="button" onClick={resetWorkspace} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted" data-testid="button-reset-workspace">
                <RotateCcw className="size-3.5" />
                Reset
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-[1240px] space-y-6 px-5 py-6 sm:px-8 sm:py-8">
            <section className="animate-in grid gap-6 xl:grid-cols-[minmax(410px,0.8fr)_minmax(520px,1.2fr)]">
              <form onSubmit={submitPrediction} className="rounded-2xl border border-border bg-card p-5 soft-shadow sm:p-6" data-testid="form-performance-inputs">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">01 / Add context</p>
                    <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Start with six signals</h2>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">A snapshot is enough. You can always run another check with updated numbers.</p>
                  </div>
                  <div className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-foreground">6 inputs</div>
                </div>
                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  {fields.map((field) => {
                    const Icon = field.icon;
                    return (
                      <label key={field.key} className="group block" data-testid={`field-${field.key}`}>
                        <span className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-2"><Icon className="size-3.5 text-primary" />{field.label}</span>
                          <span className="font-normal text-muted-foreground">{field.hint}</span>
                        </span>
                        <input
                          className="h-11 w-full rounded-xl border border-input bg-background px-3.5 font-display text-sm font-semibold text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={formValues[field.key]}
                          onChange={(event) => setFormValues((values: FormValues) => ({ ...values, [field.key]: event.target.value === '' ? '' : Number(event.target.value) }))}
                          data-testid={`input-${field.key}`}
                        />
                      </label>
                    );
                  })}
                </div>
                {validationError && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="error-validation">
                    <X className="mt-0.5 size-4 shrink-0" />{validationError}
                  </div>
                )}
                {predictMutation.isError && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="error-prediction">
                    <X className="mt-0.5 size-4 shrink-0" />
                    <span>{getErrorMessage(predictMutation.error)} <button type="button" className="font-bold underline underline-offset-2" onClick={() => predictMutation.mutate({ data: numericFormValues() })}>Retry</button></span>
                  </div>
                )}
                <button type="submit" disabled={predictMutation.isPending} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-wait disabled:opacity-70" data-testid="button-analyze">
                  {predictMutation.isPending ? <><span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/35 border-t-primary-foreground" />Reading your indicators</> : <>Analyze my indicators <ArrowRight className="size-4" /></>}
                </button>
                <p className="mt-3 text-center text-[11px] leading-4 text-muted-foreground">This is an educational estimate, not a final judgment or guarantee.</p>
              </form>

              <ResultPanel prediction={prediction} isLoading={predictMutation.isPending} />
            </section>

            <section className="animate-in animate-in-delay grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
              <ChatPanel
                items={chatItems}
                message={chatMessage}
                setMessage={setChatMessage}
                isPending={chatMutation.isPending}
                error={chatError}
                hasContext={Boolean(latestInput)}
                onSubmit={sendChat}
                onPreset={(message) => sendChat(undefined, message)}
              />
              <div className="rounded-2xl border border-border bg-card/75 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Info className="size-5" /></div>
                  <div>
                    <p className="font-display text-sm font-bold">A note on interpretation</p>
                    <p className="text-xs text-muted-foreground">Make the output useful, not definitive.</p>
                  </div>
                </div>
                <p className="mt-5 text-sm leading-6 text-muted-foreground">The assistant compares your snapshot with patterns in the model. It highlights distance and direction so you can choose a practical next step.</p>
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <div className="flex gap-3 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-primary" />Your indicators stay connected to this conversation only.</div>
                  <div className="flex gap-3 text-xs text-muted-foreground"><CircleHelp className="size-4 shrink-0 text-primary" />Ask “what matters most?” if the result feels unclear.</div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function ResultPanel({ prediction, isLoading }: { prediction: PredictionResult | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 soft-shadow sm:p-6" data-testid="state-prediction-loading">
        <div className="flex items-center justify-between"><div className="skeleton h-3 w-28 rounded" /><div className="skeleton size-10 rounded-full" /></div>
        <div className="mt-8 skeleton h-9 w-56 rounded-lg" />
        <div className="mt-3 skeleton h-4 w-full rounded" />
        <div className="mt-7 grid gap-3 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton h-20 rounded-xl" />)}</div>
        <div className="mt-6 space-y-3">{[1, 2, 3].map((item) => <div key={item} className="skeleton h-12 rounded-xl" />)}</div>
      </div>
    );
  }
  if (!prediction) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-gradient-to-br from-card to-accent/30 p-6 soft-shadow sm:p-8" data-testid="state-prediction-empty">
        <div className="absolute -right-14 -top-16 size-44 rounded-full border-[22px] border-primary/5" />
        <div className="absolute -right-2 top-12 size-20 rounded-full border border-primary/10" />
        <div className="relative flex min-h-[400px] flex-col justify-between">
          <div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" /></div>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-primary">02 / Your readout</p>
            <h2 className="mt-3 max-w-md font-display text-3xl font-bold leading-tight tracking-tight text-foreground">Clarity starts with a snapshot.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">Enter your six indicators and we’ll show the likely performance band, what shaped it, and where a small change may help.</p>
          </div>
          <div className="grid max-w-md gap-3 pt-10 sm:grid-cols-3">
            {['Likely band', 'Top influences', 'Practical next step'].map((label, index) => (
              <div className="rounded-xl border border-border/80 bg-background/65 p-3" key={label}>
                <span className="font-display text-lg font-bold text-primary">0{index + 1}</span>
                <p className="mt-2 text-xs font-medium leading-4 text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const category = prediction.category.toLowerCase();
  const resultHeading =
    prediction.category === 'LOW'
      ? 'Your current pattern can improve with clear next steps'
      : prediction.category === 'MEDIUM'
        ? 'You have a reasonable performance pattern'
        : 'Your indicators show a strong performance pattern';
  const topFactors = prediction.explanation.topFactors.length ? prediction.explanation.topFactors : prediction.explanation.featureImpacts.slice(0, 3);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 soft-shadow sm:p-6" data-testid="card-prediction-result">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">02 / Your readout</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">{resultHeading}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground" data-testid="text-prediction-summary">{prediction.explanation.summary}</p>
        </div>
        <div className={`category-badge category-badge-${category}`} data-testid="status-prediction-category">{prediction.category}</div>
      </div>

      <div className="mt-6 rounded-xl border border-border/80 bg-background/60 p-4" data-testid="metric-prediction-confidence">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prediction Confidence</p>
          <p className="font-display text-xl font-bold text-primary">{Math.round(prediction.confidence)}%</p>
        </div>
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Prediction confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(prediction.confidence)}
        >
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, prediction.confidence))}%` }} />
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">A model estimate of how closely your indicators match this learned group—not a guarantee of academic results.</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MetricTile label="Assigned cluster" value={`0${prediction.cluster}`} subtext="closest learning pattern" />
        <MetricTile label="Distance to center" value={prediction.explanation.distanceToAssignedCluster.toFixed(2)} subtext="lower means closer" />
      </div>

      <div className="mt-6 space-y-3">
        <Disclosure title="Why did the AI make this prediction?" icon={<Lightbulb className="size-4" />} defaultOpen testId="disclosure-why">
          <p className="text-sm leading-6 text-muted-foreground">{prediction.explanation.summary}</p>
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
            Positive influence means a feature is closer to the predicted cluster than the nearest alternative; negative means it is closer to that alternative. Moderate means it does not separate them much. These are model comparisons, not causes.
          </p>
          <div className="mt-4 grid gap-2">
            {[...prediction.explanation.featureImpacts]
              .sort((left, right) => right.distanceContribution - left.distanceContribution)
              .map((factor) => <FactorRow key={factor.feature} factor={factor} />)}
          </div>
        </Disclosure>
        <Disclosure title="Top Factors Affecting Your Prediction" icon={<TrendingUp className="size-4" />} testId="disclosure-top-factors">
          <p className="mb-3 text-xs leading-5 text-muted-foreground">Ranked by each indicator’s share of the distance margin between the predicted group and its nearest alternative.</p>
          <div className="grid gap-2">
            {topFactors.map((factor) => <FactorRow key={factor.feature} factor={factor} />)}
          </div>
        </Disclosure>
        <Disclosure title="How the AI decided" icon={<Activity className="size-4" />} testId="disclosure-how">
          <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
            <li><strong className="text-foreground">1.</strong> It checks the six values you entered: study hours, attendance, internal marks, assignment marks, previous study hours, and previous marks.</li>
            <li><strong className="text-foreground">2.</strong> It standardizes those values and applies the existing feature weights.</li>
            <li><strong className="text-foreground">3.</strong> It compares the weighted values with the model’s three learned K-means cluster centers.</li>
            <li><strong className="text-foreground">4.</strong> The nearest center determines the LOW, MEDIUM, or HIGH group.</li>
            <li><strong className="text-foreground">5.</strong> The feature explanations compare distance to the selected group against the nearest alternative; they do not establish cause and effect.</li>
          </ol>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-muted/60 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nearest alternative group</p><p className="mt-2 font-display text-xl font-bold">{prediction.explanation.nextClosestCategory ?? 'Not available'}</p><p className="mt-1 text-xs text-muted-foreground">{prediction.explanation.nextClosestDistance == null ? 'No comparison returned' : `Weighted distance ${prediction.explanation.nextClosestDistance.toFixed(2)}`}</p></div>
            <div className="rounded-xl bg-muted/60 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected reference group</p><p className="mt-2 font-display text-xl font-bold">{prediction.category}</p><p className="mt-1 text-xs text-muted-foreground">The six values at the center of the selected cluster.</p></div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(Object.entries(prediction.explanation.clusterCenter) as Array<[string, number]>).map(([key, value]) => <div className="flex items-center justify-between border-b border-border/70 py-2 text-xs" key={key}><span className="text-muted-foreground">{formatFeature(key)}</span><span className="font-display font-semibold text-foreground">{value}</span></div>)}
          </div>
        </Disclosure>
        <Disclosure title="How You Can Improve" icon={<Target className="size-4" />} testId="disclosure-improve">
          <p className="mb-3 text-sm leading-6 text-muted-foreground">{prediction.recommendation}</p>
          <div className="grid gap-3">
            {prediction.explanation.recommendations.map((recommendation, index) => (
              <div className="flex gap-3 rounded-xl border border-border/80 bg-background/50 p-3.5" key={`${recommendation.title}-${index}`}>
                <span className={`priority-dot priority-${recommendation.priority}`} />
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{recommendation.title}</p><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{recommendation.priority}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{recommendation.detail}</p></div>
              </div>
            ))}
          </div>
        </Disclosure>
        <Disclosure title="What Could Improve My Prediction?" icon={<CircleHelp className="size-4" />} testId="disclosure-what-if">
          <p className="mb-4 text-xs leading-5 text-muted-foreground">These are model-only scenarios, not guaranteed outcomes. They compare a few controllable inputs with the next cluster’s learned pattern; real academic results depend on more than these six indicators.</p>
          <div className="grid gap-2">
            {prediction.explanation.counterfactuals.map((counterfactual, index) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent/45 px-3.5 py-3" key={`${counterfactual.feature}-${index}`}>
                <div><p className="text-sm font-semibold">{counterfactual.label}</p><p className="mt-1 text-xs text-muted-foreground">{counterfactual.reason}</p></div>
                <div className="flex items-center gap-2 font-display text-xs font-semibold"><span className="rounded-lg bg-background px-2 py-1">{counterfactual.currentDisplayValue}</span><ArrowRight className="size-3 text-primary" /><span className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-primary">{counterfactual.suggestedDisplayValue}</span></div>
              </div>
            ))}
          </div>
          {prediction.explanation.counterfactuals.length === 0 && (
            <p className="rounded-xl bg-accent/45 p-3.5 text-sm leading-6 text-muted-foreground">You are already in the highest group, so the model has no higher category to compare. Focus on maintaining a steady routine and challenging yourself.</p>
          )}
        </Disclosure>
      </div>
    </div>
  );
}

function MetricTile({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return <div className="rounded-xl border border-border/80 bg-background/60 p-3.5" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-bold text-foreground">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{subtext}</p></div>;
}

function Disclosure({ title, icon, children, defaultOpen = false, testId }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean; testId: string }) {
  return <details className="group rounded-xl border border-border/80 bg-background/35" open={defaultOpen} data-testid={testId}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold marker:hidden"><span className="flex items-center gap-2.5"><span className="text-primary">{icon}</span>{title}</span><ChevronDown className="disclosure-chevron size-4 text-muted-foreground" /></summary><div className="border-t border-border/70 px-4 pb-4 pt-3">{children}</div></details>;
}

function FactorRow({ factor }: { factor: FeatureImpact }) {
  const importance = Math.round(factor.importance * 100);
  const Icon = factor.impact === 'negative' ? TrendingDown : factor.impact === 'positive' ? TrendingUp : Activity;
  const impactLabel =
    factor.impact === 'positive'
      ? 'Supports prediction'
      : factor.impact === 'negative'
        ? 'Leans toward alternative'
        : 'Moderate influence';
  const impactColor =
    factor.impact === 'negative'
      ? 'text-amber-700 bg-amber-500/10'
      : factor.impact === 'positive'
        ? 'text-emerald-700 bg-emerald-500/10'
        : 'text-primary bg-primary/10';
  return (
    <div className="rounded-xl border border-border/80 bg-background/50 p-3.5" data-testid={`factor-${factor.feature}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={`size-4 shrink-0 ${factor.impact === 'negative' ? 'text-amber-600' : factor.impact === 'positive' ? 'text-emerald-600' : 'text-primary'}`} />
          <p className="truncate text-sm font-semibold">{factor.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${impactColor}`}>{impactLabel}</span>
          <span className="font-display text-xs font-bold text-muted-foreground">{importance}% margin</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, importance)}%` }} />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{factor.reason}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-muted px-2 py-1">You: <strong className="font-display text-foreground">{factor.displayValue}</strong></span>
        <span className="rounded-md bg-muted px-2 py-1">Predicted cluster center: <strong className="font-display text-foreground">{factor.centerDisplayValue}</strong></span>
      </div>
    </div>
  );
}

function ChatPanel({ items, message, setMessage, isPending, error, hasContext, onSubmit, onPreset }: { items: Array<{ role: 'assistant' | 'student'; text: string }>; message: string; setMessage: (value: string) => void; isPending: boolean; error: string; hasContext: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onPreset: (message: string) => void }) {
  return <div className="rounded-2xl border border-border bg-card p-5 soft-shadow sm:p-6" data-testid="panel-assistant">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">03 / Ask a follow-up</p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Student Performance AI</h2>
        <p className="mt-1 text-sm font-semibold text-primary">Explainable AI Academic Performance Assistant</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Ask in plain language. Answers use your latest prediction and indicators.</p>
      </div>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true"><Sparkles className="size-5" /></div>
    </div>
    <div className="mt-5 min-h-[120px] space-y-3 rounded-xl border border-border/80 bg-background/45 p-3.5" data-testid="list-chat-messages">
      {items.length === 0 ? <div className="flex h-[92px] flex-col items-center justify-center text-center"><MessageCircle className="size-5 text-primary/70" /><p className="mt-2 text-sm font-medium text-foreground">Your questions can start here.</p><p className="mt-1 text-xs text-muted-foreground">{hasContext ? 'This conversation is linked to your latest snapshot.' : 'Run an analysis to give the assistant context.'}</p></div> : items.map((item, index) => <div className={`flex items-end gap-2 ${item.role === 'student' ? 'justify-end' : 'justify-start'}`} key={`${item.role}-${index}`}>
        {item.role === 'assistant' && <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-label="Assistant"><Sparkles className="size-3.5" /></span>}
        <div className={`max-w-[88%] whitespace-pre-line rounded-xl px-3.5 py-2.5 text-sm leading-5 ${item.role === 'student' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'}`} data-testid={`message-${item.role}-${index}`}>{item.text}</div>
      </div>)}
      {isPending && <div className="flex justify-start"><div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3" data-testid="state-chat-loading"><span className="size-1.5 animate-pulse rounded-full bg-primary" /><span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" /><span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" /></div></div>}
    </div>
    {error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert" data-testid="error-chat"><X className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
    <form className="mt-4 flex gap-2" onSubmit={onSubmit}><input value={message} onChange={(event) => setMessage(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10" placeholder="Ask what you want to understand..." aria-label="Ask the assistant a question" data-testid="input-chat-message" /><button type="submit" disabled={!message.trim() || isPending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send question" data-testid="button-send-chat"><Send className="size-4" /></button></form>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onPreset('What influenced this result most?')} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" data-testid="button-preset-influences">What influenced this?</button><button type="button" onClick={() => onPreset('What is one practical next step?')} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" data-testid="button-preset-next-step">One practical next step</button></div>
  </div>;
}

function formatFeature(feature: string) {
  return feature.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
