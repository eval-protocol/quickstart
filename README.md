<h1 align="center">Fine Tuning an SVGAgent with Eval Protocol!</h1>

<p align="center">
  <img alt="SVG Agent Training Overview" src="assets/overview.png">
</p>

<p align="center">
    Train and improve an SVG generation agent using reinforcement fine tuning with Eval Protocol.
</p>

<br/>

## Introduction

This repo demonstrates using Eval Protocol and Firework's Reinforcement Fine Tuning (RFT) to create an SVG generation agent.

A big thank you to [SVGBench](https://github.com/johnbean393/SVGBench) for the dataset. SVGBench is a comprehensive benchmark that evaluates language models on their ability to generate SVG code that meets specific visual requirements. Each prompt includes detailed criteria (like "draw a red circle in the top-left corner") that the generated SVG must fulfill.

**The Evaluation Process**: The model generates SVG code from text prompts, we render the SVGs to images, and then use GPT-4.1 as a visual judge to count how many requirements were fulfilled. This gives us concrete scores to measure improvement and lets you see dramatic before/after visual comparisons as your model gets better through training.

## Quick Start

### Prerequisites

1. **Create a Fireworks account** and install firectl: [Setup Instructions](https://docs.fireworks.ai/tools-sdks/firectl/firectl)

2. **Set up API keys in Fireworks Secrets**: Navigate to [fireworks.ai/settings/secrets](https://fireworks.ai/settings/secrets) and add:
   - `FIREWORKS_API_KEY` - Your Fireworks API key (same as the one you'll export locally)
   - `OPENAI_API_KEY` - Your OpenAI API key (we use GPT-4.1 as a visual LLM judge for evaluations)

### Installation

```bash
pip install "eval-protocol[svgbench]"
```

### Environment Setup

Set up your API keys:

```bash
export FIREWORKS_API_KEY="<your-fireworks-key>"
export FIREWORKS_ACCOUNT_ID="<your-fireworks-accountid>"
```

## Running Locally

### Option A: Using our Vercel Remote Server (Recommended)

Test the evaluation pipeline with the pre-deployed Vercel server:

```bash
pytest evaluator/test_svgagent.py -vs
```

The test automatically uses the remote server:
```
rollout_processor=RemoteRolloutProcessor(
    remote_base_url="https://vercel-svg-server-ts.vercel.app",
)
```

### Option B: Local Development Server

For local development and testing:

**Terminal 1** - Start the TypeScript server:
```bash
cd vercel_svg_server_ts
vercel dev
```

**Terminal 2** - Swap out the `remote_base_url` to:
```
rollout_processor=RemoteRolloutProcessor(
    remote_base_url="http://localhost:3000",
)
```

Then run the evaluation:
```bash
pytest evaluator/test_svgagent.py -vs
```

> See [Vercel CLI documentation](https://vercel.com/docs/cli/dev) for more information on local development.

## How Remote Rollout Processing Works

Eval Protocol enables **reinforcement learning that meets you where you are**. Instead of forcing you to rewrite your agent in a specific framework, you can implement a lightweight remote server wherever your codebase and infrastructure already live.

Your remote server is only responsible for:
- **Executing rollouts** - Run your agent logic (in this case, SVG generation from text prompts)
- **Logging to tracing** - Send structured logs to `tracing.fireworks.ai` for evaluation (see the below linked docs for more information)

In this example, we showcase a **Vercel TypeScript server** that executes single-turn SVG code generation.

> **📖 Learn More**: For a complete deep-dive into Remote Rollout Processing, see the [Remote Rollout Processor Tutorial](https://evalprotocol.io/tutorial/remote-rollout-processor).

## Training Pipeline

### 1. Create Dataset

Upload the SVGBench dataset to Fireworks:

```bash
firectl create dataset svgbench-dataset evaluator/svgbench_dataset.jsonl
```

### 2. Upload Evaluator

Deploy your evaluation logic:

```bash
cd evaluator
eval-protocol upload --entry "test_svgagent::test_svg_generation_evaluation"
```

Monitor the evaluator build status at: https://app.fireworks.ai/dashboard/evaluators/test-svgagent-test-svg-generation-evaluation

> **Note**: Wait for the evaluator status to change from "Building" to "Active" before proceeding (typically takes a few minutes).

### 3. Launch Reinforcement Fine Tuning

Start the RFT training job:

```bash
eval-protocol create rft \
  --base-model accounts/fireworks/models/qwen3-0p6b \
  --dataset-id svgbench-dataset \
  --output-model svgagent-rft-v1 \
  --evaluator-id accounts/$FIREWORKS_ACCOUNT_ID/evaluators/test-svgagent-test-svg-generation-evaluation \
  --max-context-length 65536 \
  --n 8 \
  --batch-size 128000 \
  --chunk-size 10 \
  --epochs 8 \
  --max-tokens 32768 \
  --learning-rate 0.00003 \
  --lora-rank 16 \
  --accelerator-count 1
```

### 4. Monitor Training Progress

After successful job creation, you'll see:

```
✅ Created Reinforcement Fine-tuning Job
   name: accounts/pyroworks/reinforcementFineTuningJobs/sdnld4yn

📊 Dashboard Links:
   Evaluator: https://app.fireworks.ai/dashboard/evaluators/test-svgagent-test-svg-generation-evaluation
   Dataset:   https://app.fireworks.ai/dashboard/datasets/svgbench-dataset
   RFT Job:   https://app.fireworks.ai/dashboard/fine-tuning/reinforcement/sdnld4yn
```

Click on the **RFT Job** link to view real-time training progress, epoch counts, and rollout data.

### Training Results

After successful training, you should see performance improvements reflected in the training metrics:

<p align="center">
  <img alt="SVG Agent Training Progress" src="assets/graph.png">
</p>

### SVG Quality Improvement

You can inspect individual rollouts to see the dramatic improvement in SVG generation quality. Below is a comparison between the first epoch and the final 8th epoch:

**Before (1st Epoch):**
<p align="center">
  <img alt="SVG Generation - Before Training" src="assets/before.png" width="400">
</p>

**After (8th Epoch):**
<p align="center">
  <img alt="SVG Generation - After Training" src="assets/after.png" width="400">
</p>

The reinforcement fine tuning process significantly improves the model's ability to generate accurate, detailed SVG graphics that better match the input descriptions.

## Debugging Tips

When your training is running, you have several powerful tools to debug and monitor your rollouts:

### Rollout Overview

Clicking on any **Epoch** or **Step** in the training dashboard, then clicking the **table icon** to the right, will show you a comprehensive table of all rollouts. It's a good high-level overview to see if any rollouts failed and for what reason.

<p align="center">
  <img alt="Rollout Overview Table" src="assets/rollouts.png" width="600">
</p>

### Individual Rollout Details

If you click on a specific row in the rollout table, you can see exactly what the prompt was and how the model responded. You can even copy and paste out the SVG code generated and render it yourself to see what the model did. This is how we got the results above in the before and after comparison.

<p align="center">
  <img alt="Individual Rollout Details" src="assets/rollout_details.png" width="600">
</p>

### Live Log Streaming

Clicking on **View Logs** takes you to a page of logs being streamed in. Here, you can see precisely what errors are happening to the rollouts. This is useful to debug and fix any issues with your rollouts.

<p align="center">
  <img alt="Live Log Streaming" src="assets/logs.png" width="600">
</p>

## Contact Us / Learn More
- [Discord Server](https://discord.gg/mMqQxvFD9A). Come talk to us in the #eval-protocol channel!
- [Eval Protocol Documentation](https://evalprotocol.io/introduction)
- [Remote Rollout Processor Tutorial](https://evalprotocol.io/tutorial/remote-rollout-processor)
- [SVGBench Dataset](https://github.com/johnbean393/SVGBench) - The original benchmark this project is based on
- [Fireworks AI Platform](https://fireworks.ai)