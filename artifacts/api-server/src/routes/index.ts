import { Router, type IRouter } from "express";
import healthRouter from "./health";
import predictionRouter from "./prediction";

const router: IRouter = Router();

router.use(healthRouter);
router.use(predictionRouter);

export default router;
