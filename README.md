<p align="center">
  <img src="assets/releasehub-hero.gif" alt="ReleaseHub Hero Banner" width="100%" />
</p>

<h1 align="center">
  ReleaseHub: Hallucination-Resistant Release Intelligence System
</h1>

<p align="center">
  <b>Owned by: Farheen Shabbir Shaikh</b><br>
   <b>Implementation Type : Reearch Project</b><br>
</p>

---

## Problem Statement

Modern CI/CD systems increasingly rely on AI-assisted automation to generate deployment steps, configuration changes, and release decisions. When hallucination occurs, these systems may produce incorrect commands, invalid configurations, or non-existent version updates without verification. Such errors can trigger broken pipelines, security vulnerabilities, failed builds, and unintended production changes. Ensuring grounded validation and reliable decision-making is therefore essential to prevent the propagation of incorrect actions across automated deployment workflows.

---
## Motivation

CI/CD pipelines enable rapid and reliable software delivery but also introduce significant risk as automation scales. In weakly configured environments, even a single unverified action can cascade into failures, security issues, and production instability.   This project focuses on building a hallucination-resistant, evidence-driven release intelligence system to ensure safer and more reliable AI-assisted CI/CD workflows.

---

## 🧠 Proposed Approach

To reduce hallucination in CI/CD workflows, this system uses two techniques:  
(1) advanced prompting  </br>
(2) abstention with “I don’t know”.


### 🔹 Advanced Prompting

#### 1) External Knowledge Restriction: Limits the LLM to use only retrieved, trusted data instead of its internal knowledge, ensuring responses are grounded and verifiable.

#### 2) Iterative Refinement: Reuses the model’s initial output for follow-up prompts to verify, correct, and improve the response.

#### 3) Directional Stimulus Prompting: Guides the model with structured hints to focus on relevant aspects like vendor, version,patch for more precise outputs.

### 🛑 Abstention

Returns:
> “I don’t know based on available verified data”
- Avoids incorrect or unsafe outputs  
- Ensures only evidence-backed responses  

---

## Research setup

#### Data Source


| Source | Description |
|--------|-------------|
| `ReleaseTrain OS API` | Operating system version and release note data |
| `ReleaseTrain Reddit API` | Community discussions and update references |
| `Vendor Names API` | Vendor normalization and filtering |
| `Internal CSV` | Structured survey and supporting release intelligence data |

---

## ⚙️ System Architecture


## Product Demonstration


<img width="1000" height="600" alt="Screenshot 2026-03-29 at 4 54 18 PM" src="https://github.com/user-attachments/assets/ab809719-155e-487f-b5b4-ce1f99a4f855" />
<img width="1000" height="600" alt="Screenshot 2026-03-29 at 4 52 14 PM" src="https://github.com/user-attachments/assets/82d5be55-49bd-410a-aed0-e289a3dd1d17" />


## Experiment Result

## Future Directions



