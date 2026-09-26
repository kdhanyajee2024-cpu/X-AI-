import type {
  Counterfactual,
  FeatureImpact,
  ImprovementSuggestion,
  PredictionInput,
  PredictionResult,
  PredictionResultCategory,
} from "@workspace/api-zod";

const FEATURE_ORDER = [
  "studyHours",
  "attendance",
  "internalMarks",
  "assignmentMarks",
  "previousStudyHours",
  "previousMarks",
] as const satisfies readonly (keyof PredictionInput)[];

const FEATURE_WEIGHTS = [2.5, 1, 1, 1, 1.35, 1] as const;

const FEATURE_LIMITS: Record<
  keyof PredictionInput,
  { min: number; max: number; label: string; unit: "hours" | "percent" }
> = {
  studyHours: { min: 0, max: 24, label: "Study Hours", unit: "hours" },
  attendance: { min: 0, max: 100, label: "Attendance", unit: "percent" },
  internalMarks: { min: 0, max: 100, label: "Internal Marks", unit: "percent" },
  assignmentMarks: {
    min: 0,
    max: 100,
    label: "Assignment Marks",
    unit: "percent",
  },
  previousStudyHours: {
    min: 0,
    max: 24,
    label: "Previous Study Hours",
    unit: "hours",
  },
  previousMarks: { min: 0, max: 100, label: "Previous Marks", unit: "percent" },
};

type Vector = number[];
type Category = PredictionResultCategory;

interface TrainedModel {
  means: Vector;
  standardDeviations: Vector;
  centers: Vector[];
  centerCategories: Category[];
}

interface ClassifiedInput {
  transformed: Vector;
  distances: number[];
  closestCenter: number;
  category: Category;
  confidence: number;
}

const CATEGORY_RANK: Record<Category, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function seededRandom(seed: { value: number }): number {
  seed.value = (1664525 * seed.value + 1013904223) >>> 0;
  return seed.value / 4294967296;
}

function generateCluster(
  ranges: Array<[number, number]>,
  count: number,
  seed: { value: number },
): Vector[] {
  return Array.from({ length: count }, () =>
    ranges.map(([min, max]) => min + (max - min) * seededRandom(seed)),
  );
}

function generateTrainingData(): Vector[] {
  const seed = { value: 42 };
  const low = generateCluster(
    [
      [0.25, 2.5],
      [30, 60],
      [25, 55],
      [20, 50],
      [0.25, 3],
      [30, 55],
    ],
    100,
    seed,
  );
  const medium = generateCluster(
    [
      [2.5, 6],
      [60, 85],
      [55, 80],
      [50, 75],
      [2.5, 6],
      [55, 75],
    ],
    100,
    seed,
  );
  const high = generateCluster(
    [
      [6, 12],
      [85, 100],
      [80, 100],
      [75, 100],
      [6, 12],
      [75, 100],
    ],
    100,
    seed,
  );

  return [...low, ...medium, ...high];
}

function mean(values: Vector): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fitScaler(data: Vector[]): {
  means: Vector;
  standardDeviations: Vector;
} {
  const means = FEATURE_ORDER.map((_, featureIndex) =>
    mean(data.map((row) => row[featureIndex])),
  );
  const standardDeviations = FEATURE_ORDER.map((_, featureIndex) => {
    const variance = mean(
      data.map((row) => (row[featureIndex] - means[featureIndex]) ** 2),
    );
    return Math.sqrt(variance) || 1;
  });

  return { means, standardDeviations };
}

function transform(
  row: Vector,
  means: Vector,
  standardDeviations: Vector,
): Vector {
  return row.map(
    (value, index) =>
      ((value - means[index]) / standardDeviations[index]) *
      FEATURE_WEIGHTS[index],
  );
}

function inverseTransform(
  row: Vector,
  means: Vector,
  standardDeviations: Vector,
): Vector {
  return row.map(
    (value, index) =>
      (value / FEATURE_WEIGHTS[index]) * standardDeviations[index] +
      means[index],
  );
}

function squaredDistance(left: Vector, right: Vector): number {
  return left.reduce(
    (sum, value, index) => sum + (value - right[index]) ** 2,
    0,
  );
}

function trainKMeans(data: Vector[]): TrainedModel {
  const { means, standardDeviations } = fitScaler(data);
  const scaledData = data.map((row) =>
    transform(row, means, standardDeviations),
  );
  let centers = [scaledData[0], scaledData[100], scaledData[200]].map((row) => [
    ...row,
  ]);

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const assignments = scaledData.map((row) => {
      let closest = 0;
      let closestDistance = squaredDistance(row, centers[0]);

      for (let centerIndex = 1; centerIndex < centers.length; centerIndex += 1) {
        const distance = squaredDistance(row, centers[centerIndex]);
        if (distance < closestDistance) {
          closest = centerIndex;
          closestDistance = distance;
        }
      }

      return closest;
    });

    const nextCenters = centers.map((center, centerIndex) => {
      const assigned = scaledData.filter(
        (_, rowIndex) => assignments[rowIndex] === centerIndex,
      );
      if (assigned.length === 0) return center;

      return center.map((_, featureIndex) =>
        mean(assigned.map((row) => row[featureIndex])),
      );
    });

    const largestMovement = centers.reduce(
      (largest, center, centerIndex) =>
        Math.max(
          largest,
          Math.sqrt(squaredDistance(center, nextCenters[centerIndex])),
        ),
      0,
    );
    centers = nextCenters;

    if (largestMovement < 0.000001) break;
  }

  const performanceScore = (center: Vector): number => {
    const normalized = [
      center[0] / 12,
      center[4] / 12,
      center[1] / 100,
      center[2] / 100,
      center[3] / 100,
      center[5] / 100,
    ];
    return (
      normalized[0] * 0.45 +
      normalized[1] * 0.2 +
      normalized[2] * 0.1 +
      normalized[3] * 0.1 +
      normalized[4] * 0.075 +
      normalized[5] * 0.075
    );
  };

  const ranked = centers
    .map((center, index) => ({
      index,
      score: performanceScore(
        inverseTransform(center, means, standardDeviations),
      ),
    }))
    .sort((left, right) => left.score - right.score);
  const categoryByRank = ["LOW", "MEDIUM", "HIGH"] as const;
  const centerCategories = centers.map(
    (_, centerIndex) =>
      categoryByRank[ranked.findIndex(({ index }) => index === centerIndex)],
  );

  return { means, standardDeviations, centers, centerCategories };
}

const MODEL = trainKMeans(generateTrainingData());

export function validatePredictionInput(
  input: Partial<PredictionInput>,
): { valid: true; input: PredictionInput } | { valid: false; message: string } {
  for (const feature of FEATURE_ORDER) {
    const value = input[feature];
    const limits = FEATURE_LIMITS[feature];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < limits.min ||
      value > limits.max
    ) {
      return { valid: false, message: "Enter valid input" };
    }
  }

  if (input.studyHours === 0 || input.previousStudyHours === 0) {
    return { valid: false, message: "Study hours must be greater than zero." };
  }

  return { valid: true, input: input as PredictionInput };
}

function inputToVector(input: PredictionInput): Vector {
  return FEATURE_ORDER.map((feature) => input[feature]);
}

function vectorToInput(vector: Vector): PredictionInput {
  return {
    studyHours: vector[0],
    attendance: vector[1],
    internalMarks: vector[2],
    assignmentMarks: vector[3],
    previousStudyHours: vector[4],
    previousMarks: vector[5],
  };
}

function classify(input: PredictionInput): ClassifiedInput {
  const transformed = transform(
    inputToVector(input),
    MODEL.means,
    MODEL.standardDeviations,
  );
  const distances = MODEL.centers.map((center) =>
    Math.sqrt(squaredDistance(transformed, center)),
  );
  let closestCenter = 0;

  for (let centerIndex = 1; centerIndex < distances.length; centerIndex += 1) {
    if (distances[centerIndex] < distances[closestCenter]) {
      closestCenter = centerIndex;
    }
  }

  const distanceTotal = distances.reduce((sum, distance) => sum + distance, 0);
  const confidence =
    distanceTotal === 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            (1 - distances[closestCenter] / distanceTotal) * 100,
          ),
        );

  return {
    transformed,
    distances,
    closestCenter,
    category: MODEL.centerCategories[closestCenter],
    confidence: Number(confidence.toFixed(1)),
  };
}

function displayValue(feature: keyof PredictionInput, value: number): string {
  const number = Number(value.toFixed(1));
  const formatted = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return FEATURE_LIMITS[feature].unit === "hours"
    ? `${formatted} hrs/day`
    : `${formatted}%`;
}

function getClusterCenter(centerIndex: number): PredictionInput {
  return vectorToInput(
    inverseTransform(
      MODEL.centers[centerIndex],
      MODEL.means,
      MODEL.standardDeviations,
    ),
  );
}

function getNextCategory(category: Category): Category | null {
  if (category === "LOW") return "MEDIUM";
  if (category === "MEDIUM") return "HIGH";
  return null;
}

function buildRecommendations(
  input: PredictionInput,
  category: Category,
  assignedCenter: PredictionInput,
  nextCenter: PredictionInput | null,
): ImprovementSuggestion[] {
  const target = nextCenter ?? assignedCenter;
  const weakFeatures = FEATURE_ORDER.map((feature, index) => {
    const difference = target[feature] - input[feature];
    const range = FEATURE_LIMITS[feature].max - FEATURE_LIMITS[feature].min;
    const tolerance = Math.max(
      MODEL.standardDeviations[index] * 0.18,
      range * 0.025,
    );
    return {
      feature,
      deficit: difference > tolerance ? difference / range : 0,
      difference,
    };
  })
    .filter(({ deficit }) => deficit > 0)
    .sort((left, right) => right.deficit - left.deficit)
    .slice(0, category === "HIGH" ? 2 : 4);

  if (category === "HIGH") {
    const maintaining = weakFeatures
      .filter(
        ({ feature }) =>
          feature !== "previousStudyHours" && feature !== "previousMarks",
      )
      .map(({ feature }) => ({
      feature,
      title: `Maintain ${FEATURE_LIMITS[feature].label.toLowerCase()}`,
      detail: `Your ${FEATURE_LIMITS[feature].label.toLowerCase()} is a little below the center of the HIGH cluster. Keep it steady and review your progress regularly.`,
      priority: "maintain" as const,
      }));
    return maintaining.length > 0
      ? maintaining
      : [
          {
            feature: null,
            title: "Keep your routine consistent",
            detail:
              "Your indicators fit the HIGH cluster well. Maintain your study routine, use spaced revision, and keep practicing challenging questions.",
            priority: "maintain",
          },
        ];
  }

  const detailByFeature: Record<keyof PredictionInput, string> = {
    studyHours: `You reported ${displayValue("studyHours", input.studyHours)}. Add one focused session at a time and work toward the next cluster's study pattern without sacrificing rest.`,
    attendance: `Your attendance is ${displayValue("attendance", input.attendance)}. Set a weekly attendance goal and keep a steady class routine so lessons build on one another.`,
    internalMarks: `Your internal marks are ${displayValue("internalMarks", input.internalMarks)}. Review assessment topics each week and practice questions similar to the ones you missed.`,
    assignmentMarks: `Your assignment marks are ${displayValue("assignmentMarks", input.assignmentMarks)}. Start earlier, check the marking criteria, and review each answer before you submit.`,
    previousStudyHours: `Your previous study pattern was ${displayValue("previousStudyHours", input.previousStudyHours)}. Use it as a baseline: plan focused sessions around the topics that need more practice now.`,
    previousMarks: `Your previous marks were ${displayValue("previousMarks", input.previousMarks)}. Review where marks were lost and use those topics to guide your current revision plan.`,
  };
  const titleByFeature: Record<keyof PredictionInput, string> = {
    studyHours: "Focus on study hours",
    attendance: "Focus on attendance",
    internalMarks: "Focus on internal marks",
    assignmentMarks: "Focus on assignment marks",
    previousStudyHours: "Use previous study as a baseline",
    previousMarks: "Learn from previous marks",
  };

  const suggestions: ImprovementSuggestion[] = weakFeatures.map(
    ({ feature, deficit }) => ({
      feature,
      title: titleByFeature[feature],
      detail: detailByFeature[feature],
      priority: deficit >= 0.18 ? "high" : "medium",
    }),
  );

  const marksBelowStrongRange =
    input.internalMarks < 70 || input.assignmentMarks < 70;
  if (input.studyHours >= 4.5 && marksBelowStrongRange) {
    suggestions.unshift({
      feature: null,
      title: "Make study time more effective",
      detail:
        "Since you already spend time studying, try active recall, timed practice questions, spaced revision, and checking your work against quality notes before adding more hours.",
      priority: "high",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      feature: null,
      title: "Build consistency across the indicators",
      detail:
        "Your values are close to this cluster's next-level profile. Keep a regular study and revision schedule, then check your indicators again after your next assessments.",
      priority: "medium",
    });
  }

  return suggestions.slice(0, 4);
}

function buildCounterfactuals(
  input: PredictionInput,
  current: ClassifiedInput,
): Counterfactual[] {
  const nextCategory = getNextCategory(current.category);
  if (!nextCategory) return [];

  const nextCenterIndex = MODEL.centerCategories.findIndex(
    (category) => category === nextCategory,
  );
  if (nextCenterIndex < 0) return [];

  const nextCenter = getClusterCenter(nextCenterIndex);
  const controllableFeatures = [
    "studyHours",
    "attendance",
    "internalMarks",
    "assignmentMarks",
  ] as const;
  const candidates = controllableFeatures
    .map((feature) => {
      const difference = nextCenter[feature] - input[feature];
      const range = FEATURE_LIMITS[feature].max - FEATURE_LIMITS[feature].min;
      return {
        feature,
        difference,
        score: difference > 0 ? (difference / range) * FEATURE_WEIGHTS[FEATURE_ORDER.indexOf(feature)] : 0,
      };
    })
    .filter((candidate) => candidate.score > 0.015)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  if (candidates.length === 0) return [];

  const roundScenario = (feature: (typeof controllableFeatures)[number], value: number) =>
    feature === "studyHours" ? Math.round(value * 2) / 2 : Math.round(value);

  return candidates
    .map(({ feature, difference }) => {
      let selectedProgress = 1;
      for (let step = 1; step <= 40; step += 1) {
        const progress = step / 40;
        const proposed = input[feature] + difference * progress;
        const scenario = {
          ...input,
          [feature]: Math.min(
            FEATURE_LIMITS[feature].max,
            roundScenario(feature, proposed),
          ),
        };
        if (
          CATEGORY_RANK[classify(scenario).category] >
          CATEGORY_RANK[current.category]
        ) {
          selectedProgress = progress;
          break;
        }
      }

      const suggestedValue = Math.min(
        FEATURE_LIMITS[feature].max,
        roundScenario(
          feature,
          input[feature] + difference * selectedProgress,
        ),
      );
      const scenario = { ...input, [feature]: suggestedValue };
      const scenarioResult = classify(scenario);
      return {
        feature,
        label: FEATURE_LIMITS[feature].label,
        currentValue: input[feature],
        suggestedValue,
        currentDisplayValue: displayValue(feature, input[feature]),
        suggestedDisplayValue: displayValue(feature, suggestedValue),
        reason:
          CATEGORY_RANK[scenarioResult.category] >
          CATEGORY_RANK[current.category]
            ? `Holding your other five indicators constant, changing only ${FEATURE_LIMITS[feature].label.toLowerCase()} to ${displayValue(feature, suggestedValue)} gives the model a ${scenarioResult.category} result with ${scenarioResult.confidence}% confidence. This model-only estimate is not a guarantee of academic outcomes.`
            : `Holding your other five indicators constant, changing only ${FEATURE_LIMITS[feature].label.toLowerCase()} to ${displayValue(feature, suggestedValue)} keeps the model in the ${scenarioResult.category} group. A single change may not affect the category; this estimate is not a guarantee of academic outcomes.`,
      };
    })
    .filter(({ currentValue, suggestedValue }) => suggestedValue > currentValue);
}

function buildSummary(
  category: Category,
  cluster: number,
  impacts: FeatureImpact[],
  alternativeCategory: Category | null,
): string {
  const notable = impacts.slice(0, 2);
  const factorText = notable
    .map(({ label, impact, importance }) => {
      const direction =
        impact === "positive"
          ? `supports ${category}`
          : impact === "negative"
            ? `leans toward ${alternativeCategory ?? "another cluster"}`
            : "does not strongly separate the two clusters";
      return `${label} ${direction} (${(importance * 100).toFixed(0)}% of the feature-level distance margin)`;
    })
    .join("; ");

  return factorText
    ? `The model assigned your indicators to the ${category} performance group (cluster ${cluster}) because that weighted K-means center is closest overall. Compared with the nearest alternative${alternativeCategory ? ` (${alternativeCategory})` : ""}, ${factorText}. These comparisons explain the model's cluster choice; they do not show that any one factor caused the result.`
    : `The model matched your indicators most closely with the ${category} performance group (cluster ${cluster}). Your values closely match that group's learned profile. This is an estimate from the supplied indicators, not a guarantee.`;
}

export function predictPerformance(input: PredictionInput): PredictionResult {
  const classified = classify(input);
  const assignedCenter = getClusterCenter(classified.closestCenter);
  const distancesToOtherCenters = classified.distances
    .map((distance, index) => ({
      distance,
      index,
      category: MODEL.centerCategories[index],
    }))
    .filter((item) => item.category !== classified.category)
    .sort((left, right) => left.distance - right.distance);
  const nearestAlternative = distancesToOtherCenters[0] ?? null;
  const alternativeCenter = nearestAlternative
    ? getClusterCenter(nearestAlternative.index)
    : assignedCenter;
  const totalAbsoluteMargin = FEATURE_ORDER.reduce((sum, feature, index) => {
    const assignedDifference =
      classified.transformed[index] -
      MODEL.centers[classified.closestCenter][index];
    const alternativeDifference =
      classified.transformed[index] -
      (nearestAlternative
        ? MODEL.centers[nearestAlternative.index][index]
        : MODEL.centers[classified.closestCenter][index]);
    return (
      sum +
      Math.abs(
        alternativeDifference ** 2 - assignedDifference ** 2,
      )
    );
  }, 0);
  const featureImpacts: FeatureImpact[] = FEATURE_ORDER.map(
    (feature, index) => {
      const assignedDifference =
        classified.transformed[index] -
        MODEL.centers[classified.closestCenter][index];
      const alternativeDifference =
        classified.transformed[index] -
        (nearestAlternative
          ? MODEL.centers[nearestAlternative.index][index]
          : MODEL.centers[classified.closestCenter][index]);
      const margin = alternativeDifference ** 2 - assignedDifference ** 2;
      const contribution = Math.abs(margin);
      const deadband = Math.max(
        0.01,
        (alternativeDifference ** 2 + assignedDifference ** 2) * 0.015,
      );
      const impact =
        Math.abs(margin) <= deadband
          ? "moderate"
          : margin > 0
            ? "positive"
            : "negative";
      const importance =
        totalAbsoluteMargin === 0 ? 0 : contribution / totalAbsoluteMargin;
      const share = (importance * 100).toFixed(0);
      const reason =
        contribution === 0
          ? `${displayValue(feature, input[feature])} is equally distant from the ${classified.category} and ${nearestAlternative?.category ?? "alternative"} centers for this feature, so it does not distinguish between them.`
          : impact === "moderate"
            ? `${displayValue(feature, input[feature])} is similarly close to the ${classified.category} center (${displayValue(feature, assignedCenter[feature])}) and ${nearestAlternative?.category ?? "alternative"} center (${displayValue(feature, alternativeCenter[feature])}). It makes little difference between these two clusters.`
            : impact === "positive"
              ? `${displayValue(feature, input[feature])} is closer to the ${classified.category} center (${displayValue(feature, assignedCenter[feature])}) than the ${nearestAlternative?.category ?? "alternative"} center (${displayValue(feature, alternativeCenter[feature])}), supporting ${classified.category}. This feature accounts for ${share}% of the absolute distance margin.`
              : `${displayValue(feature, input[feature])} is closer to the ${nearestAlternative?.category ?? "alternative"} center (${displayValue(feature, alternativeCenter[feature])}) than the ${classified.category} center (${displayValue(feature, assignedCenter[feature])}), pulling away from ${classified.category}. This feature accounts for ${share}% of the absolute distance margin.`;

      return {
        feature,
        label: FEATURE_LIMITS[feature].label,
        value: input[feature],
        displayValue: displayValue(feature, input[feature]),
        centerValue: assignedCenter[feature],
        centerDisplayValue: displayValue(feature, assignedCenter[feature]),
        impact,
        importance: Number(importance.toFixed(6)),
        distanceContribution: Number(contribution.toFixed(6)),
        reason,
      };
    },
  );

  const topFactors = [...featureImpacts]
    .sort((left, right) => right.distanceContribution - left.distanceContribution)
    .slice(0, 3);
  const nextCategory = getNextCategory(classified.category);
  const nextCenterIndex = nextCategory
    ? MODEL.centerCategories.findIndex((category) => category === nextCategory)
    : -1;
  const nextCenter =
    nextCenterIndex >= 0 ? getClusterCenter(nextCenterIndex) : null;
  const recommendations = buildRecommendations(
    input,
    classified.category,
    assignedCenter,
    nextCenter,
  );

  const recommendation =
    classified.category === "LOW"
      ? "Focus on a steady study routine, regular attendance, and feedback from your recent assessments."
      : classified.category === "MEDIUM"
        ? "Build on the indicators already working well and focus first on the largest gaps shown below."
        : "Your indicators align with the HIGH group. Keep your routine consistent and continue challenging yourself.";

  return {
    category: classified.category,
    confidence: classified.confidence,
    cluster: classified.closestCenter + 1,
    recommendation,
    input,
    explanation: {
      summary: buildSummary(
        classified.category,
        classified.closestCenter + 1,
        topFactors,
        nearestAlternative?.category ?? null,
      ),
      distanceToAssignedCluster: Number(
        classified.distances[classified.closestCenter].toFixed(4),
      ),
      nextClosestCategory: nearestAlternative?.category ?? null,
      nextClosestDistance:
        nearestAlternative === null
          ? null
          : Number(nearestAlternative.distance.toFixed(4)),
      clusterCenter: assignedCenter,
      featureImpacts,
      topFactors,
      recommendations,
      counterfactuals: buildCounterfactuals(input, classified),
    },
  };
}