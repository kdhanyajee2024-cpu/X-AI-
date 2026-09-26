import { Router, type IRouter } from "express";
import {
  ChatBody,
  ChatResponse,
  PredictPerformanceBody,
  PredictPerformanceResponse,
  type ChatResult,
  type PredictionInput,
  type PredictionResult,
} from "@workspace/api-zod";
import {
  predictPerformance,
  validatePredictionInput,
} from "../lib/performance-model";

const router: IRouter = Router();

const CONVERSATIONAL_RESPONSES: Record<string, string> = {
  greetings:
    "Hello! I’m your Student Performance AI assistant. I can explain a prediction from your six academic indicators or help you enter them.",
  help:
    "I can estimate LOW, MEDIUM, or HIGH performance from Study Hours, Attendance, Internal Marks, Assignment Marks, Previous Study Hours, and Previous Marks. After a prediction, ask why it was made or what to improve first.",
  kmeans:
    "The system standardizes the six indicators, applies its existing feature weights, and compares the result with three learned K-means cluster centers. The nearest center determines LOW, MEDIUM, or HIGH. The explanation shows how much each feature contributes to the distance from that center; it does not claim those features caused the outcome.",
  thanks: "You’re welcome. You can ask another question about your latest prediction whenever you’re ready.",
  goodbye: "Goodbye. You can return whenever you want to check another set of academic indicators.",
};

type StudentData = PredictionInput;
type FeatureKey = keyof StudentData;

const FIELD_PATTERNS: Record<FeatureKey, RegExp[]> = {
  studyHours: [
    /(?<!previous\s)study\s*hours?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /(\-?\d+(?:\.\d+)?)\s*hours?\s*(?:of\s*)?stud(?:y|ying)/i,
    /(?<!previously\s)stud(?:y|ying)\s*(?:for\s*)?(\-?\d+(?:\.\d+)?)\s*hours?/i,
  ],
  attendance: [
    /attendance[:\s=]*(\-?\d+(?:\.\d+)?)\s*%?/i,
    /(\-?\d+(?:\.\d+)?)\s*%\s*attendance/i,
    /attend(?:s|ed|ing)?[:\s=]+(\-?\d+(?:\.\d+)?)\s*%?/i,
  ],
  internalMarks: [
    /internal\s*marks?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /internal(?:\s*score|\s*assessment)?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /(\-?\d+(?:\.\d+)?)\s*internal\s*marks?/i,
  ],
  assignmentMarks: [
    /assignment\s*marks?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /assignment(?:\s*score)?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /(\-?\d+(?:\.\d+)?)\s*assignment\s*marks?/i,
  ],
  previousStudyHours: [
    /previous\s*study\s*hours?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /past\s*study\s*hours?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /previous(?:ly)?\s*stud(?:y|ied|ying)\s*(?:for\s*)?(\-?\d+(?:\.\d+)?)\s*hours?/i,
  ],
  previousMarks: [
    /previous\s*marks?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /past\s*marks?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /last\s*(?:sem(?:ester)?\s*)?marks?[:\s=]*(\-?\d+(?:\.\d+)?)/i,
    /previous(?:ly)?\s*(?:got|scored|received)\s*(\-?\d+(?:\.\d+)?)/i,
    /previous(?:ly)?\s*stud(?:y|ied|ying).*?\band\s+scored\s+(\-?\d+(?:\.\d+)?)/i,
  ],
};

function detectIntent(message: string): string | null {
  const normalized = message.toLowerCase().trim();
  if (/^(hi|hello|hey|hola|greetings)[\s!.]*$/.test(normalized)) {
    return "greetings";
  }
  if (
    ["help", "what can you do", "how to use", "instructions", "guide"].some(
      (keyword) => normalized.includes(keyword),
    )
  ) {
    return "help";
  }
  if (
    ["kmeans", "k-means", "clustering", "algorithm", "machine learning", "how do you predict", "how does the ai decide"].some(
      (keyword) => normalized.includes(keyword),
    )
  ) {
    return "kmeans";
  }
  if (["thank", "thanks", "thx", "appreciate"].some((word) => normalized.includes(word))) {
    return "thanks";
  }
  if (["bye", "goodbye", "see you", "farewell", "exit", "quit"].some((word) => normalized.includes(word))) {
    return "goodbye";
  }
  return null;
}

function extractStudentData(message: string): Partial<StudentData> {
  const extracted: Partial<StudentData> = {};
  for (const [feature, patterns] of Object.entries(FIELD_PATTERNS) as Array<
    [FeatureKey, RegExp[]]
  >) {
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) extracted[feature] = value;
      break;
    }
  }
  return extracted;
}

function emptyChatResponse(response: string): ChatResult {
  return {
    response,
    prediction: null,
    confidence: null,
    predictionResult: null,
  };
}

function featureForQuestion(message: string): FeatureKey | null {
  const normalized = message.toLowerCase();
  if (normalized.includes("attendance")) return "attendance";
  if (normalized.includes("assignment")) return "assignmentMarks";
  if (normalized.includes("internal")) return "internalMarks";
  if (normalized.includes("previous") && normalized.includes("hour")) {
    return "previousStudyHours";
  }
  if (normalized.includes("previous") || normalized.includes("last exam")) {
    return "previousMarks";
  }
  if (normalized.includes("study") || normalized.includes("hour")) {
    return "studyHours";
  }
  return null;
}

function getHypotheticalInput(
  message: string,
  input: PredictionInput,
): PredictionInput | null {
  const normalized = message.toLowerCase();
  const feature = featureForQuestion(message);
  if (!feature || !/\b(what if|if i|suppose|imagine)\b/.test(normalized)) {
    return null;
  }
  if (feature === "previousStudyHours" || feature === "previousMarks") {
    return null;
  }

  const explicitTarget = /\b(?:to|at)\s*(\d+(?:\.\d+)?)\s*%?\b/.exec(normalized);
  const increaseBy = /\b(?:increase|improve|raise)\b.*?\bby\s*(\d+(?:\.\d+)?)\b/.exec(normalized);
  const decreaseBy = /\bdecrease\b.*?\bby\s*(\d+(?:\.\d+)?)\b/.exec(normalized);
  const amount = explicitTarget
    ? Number(explicitTarget[1])
    : increaseBy
      ? input[feature] + Number(increaseBy[1])
      : decreaseBy
        ? input[feature] - Number(decreaseBy[1])
        : null;
  if (amount === null || !Number.isFinite(amount)) return null;
  if (feature === "studyHours" && amount <= 0) return null;

  const limits: Record<FeatureKey, { min: number; max: number }> = {
    studyHours: { min: 0, max: 24 },
    attendance: { min: 0, max: 100 },
    internalMarks: { min: 0, max: 100 },
    assignmentMarks: { min: 0, max: 100 },
    previousStudyHours: { min: 0, max: 24 },
    previousMarks: { min: 0, max: 100 },
  };
  if (amount < limits[feature].min || amount > limits[feature].max) return null;
  return { ...input, [feature]: amount };
}

function formatScenarioAnswer(
  feature: FeatureKey,
  input: PredictionInput,
  scenario: PredictionInput,
  result: PredictionResult,
): string {
  const units = feature === "studyHours" || feature === "previousStudyHours" ? " hrs/day" : "%";
  return `Holding your other five inputs constant, changing ${feature.replace(/([A-Z])/g, " $1").toLowerCase()} from ${input[feature]}${units} to ${scenario[feature]}${units} gives the model a ${result.category} result with ${result.confidence}% confidence. This is a model-only scenario, not a guarantee of academic outcomes.`;
}

function answerFromPrediction(
  message: string,
  prediction: PredictionResult,
): string {
  const normalized = message.toLowerCase();
  const explanation = prediction.explanation;
  const feature = featureForQuestion(message);
  const isWhatIf = /\b(what if|if i|suppose|imagine)\b/.test(normalized);
  if (
    isWhatIf &&
    (feature === "previousStudyHours" || feature === "previousMarks")
  ) {
    return "Previous study hours and previous marks are historical inputs, so I can’t change them in a what-if scenario. Try current study hours, attendance, internal marks, or assignment marks instead.";
  }
  const hypothetical = getHypotheticalInput(message, prediction.input);
  if (hypothetical) {
    const hypotheticalResult = predictPerformance(hypothetical);
    return feature
      ? formatScenarioAnswer(feature, prediction.input, hypothetical, hypotheticalResult)
      : `In this model-only scenario, the nearest category is ${hypotheticalResult.category}. This is not a guarantee of academic outcomes.`;
  }

  if (
    feature &&
    (normalized.includes("why") ||
      normalized.includes("affect") ||
      normalized.includes("impact") ||
      normalized.includes("influence"))
  ) {
    const impact = explanation.featureImpacts.find(
      (item) => item.feature === feature,
    );
    return impact
      ? impact.reason
      : `The model does not have a feature-level distance for ${feature}.`;
  }

  if (/\b(what should|improve|recommend|first|next step|suggest)\b/.test(normalized)) {
    const first = explanation.recommendations[0];
    const rest = explanation.recommendations.slice(1, 3);
    return first
      ? `Start here: ${first.title}. ${first.detail}${rest.length ? ` Also consider: ${rest.map(({ detail }) => detail).join(" ")}` : ""}`
      : prediction.recommendation;
  }

  if (/\b(top|most|factor|affect|influence|main)\b/.test(normalized)) {
    const factors = explanation.topFactors
      .slice(0, 3)
      .map(
        ({ label, importance, reason }, index) =>
          `${index + 1}. ${label} (${(importance * 100).toFixed(0)}% of the distance): ${reason}`,
      );
    return factors.length
      ? `The largest differences from your ${prediction.category} cluster profile are:\n${factors.join("\n")}`
      : explanation.summary;
  }

  if (/\b(why|reason|explain|low|medium|high|prediction|result)\b/.test(normalized)) {
    return explanation.summary;
  }

  if (/\b(what if|if i increase|if i improve)\b/.test(normalized)) {
    const suggestion = explanation.counterfactuals[0];
    return suggestion
      ? `One possible scenario is to move ${suggestion.label.toLowerCase()} from ${suggestion.currentDisplayValue} toward ${suggestion.suggestedDisplayValue}. ${suggestion.reason}`
      : `Your pattern is already in the HIGH group, so the model has no higher category to compare against. Focus on consistency and challenging practice; this estimate is not a guarantee.`;
  }

  return `${explanation.summary}\n\n${prediction.recommendation} You can ask which factor matters most, why a specific input appears in the explanation, or what-if questions.`;
}

function withPrediction(
  response: string,
  prediction: PredictionResult,
  includeFullResult: boolean,
): ChatResult {
  return {
    response,
    prediction: prediction.category,
    confidence: prediction.confidence,
    predictionResult: includeFullResult ? prediction : null,
  };
}

router.post("/predict", (req, res): void => {
  const parsed = PredictPerformanceBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "Invalid prediction input");
    res.status(400).json({ error: "Enter valid input for all six indicators." });
    return;
  }

  const validation = validatePredictionInput(parsed.data);
  if (!validation.valid) {
    res.status(400).json({ error: validation.message });
    return;
  }

  const result = predictPerformance(validation.input);
  res.json(PredictPerformanceResponse.parse(result));
});

router.post("/chat", (req, res): void => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid message." });
    return;
  }

  const message = parsed.data.message.trim();
  if (!message) {
    res.status(400).json({ error: "Enter a valid message." });
    return;
  }

  const intent = detectIntent(message);
  if (intent) {
    res.json(ChatResponse.parse(emptyChatResponse(CONVERSATIONAL_RESPONSES[intent])));
    return;
  }

  const extracted = extractStudentData(message);
  const hasFullInput = Object.keys(extracted).length === 6;
  let predictionInput: PredictionInput | null = null;
  let inputFromMessage = false;

  if (hasFullInput) {
    const messageValidation = validatePredictionInput(extracted);
    if (!messageValidation.valid) {
      res.json(emptyChatResponse(messageValidation.message));
      return;
    }
    predictionInput = messageValidation.input;
    inputFromMessage = true;
  } else if (parsed.data.latestInput) {
    const contextValidation = validatePredictionInput(parsed.data.latestInput);
    if (!contextValidation.valid) {
      res.status(400).json({ error: contextValidation.message });
      return;
    }
    predictionInput = contextValidation.input;
  }

  if (!predictionInput) {
    const missing = [
      ["studyHours", "Study Hours"],
      ["attendance", "Attendance"],
      ["internalMarks", "Internal Marks"],
      ["assignmentMarks", "Assignment Marks"],
      ["previousStudyHours", "Previous Study Hours"],
      ["previousMarks", "Previous Marks"],
    ]
      .filter(([field]) => !(field in extracted))
      .map(([, label]) => label);
    const response =
      missing.length < 6
        ? `I need all six indicators to make a prediction. Still missing: ${missing.join(", ")}. You can enter them in the predictor, then ask me about that result.`
        : "I don’t have a current prediction to refer to yet. Enter your six indicators in the predictor first, or include Study Hours, Attendance, Internal Marks, Assignment Marks, Previous Study Hours, and Previous Marks in your message.";
    res.json(ChatResponse.parse(emptyChatResponse(response)));
    return;
  }

  const prediction = predictPerformance(predictionInput);
  const response = answerFromPrediction(message, prediction);
  res.json(
    ChatResponse.parse(
      withPrediction(response, prediction, inputFromMessage),
    ),
  );
});

export default router;