<p align="center">
  <img src="assets/releasehub-hero.gif" alt="ReleaseHub Hero Banner" width="100%" />
</p>

<h1 align="center">
  ReleaseHub: Hallucination-Resistant Release Intelligence System
</h1>

<p align="center">
  <b>Project Type:</b> Research Project <br>
  <b>My Role:</b> Researcher & Developer <br>
   <b> Expected to Publish Month : June 2026 
  
  
  
</p>

---

## Problem Statement

Modern CI/CD systems increasingly rely on AI-assisted automation to generate deployment steps, configuration changes, and release decisions. When hallucination occurs, these systems may produce incorrect commands, invalid configurations, and sometimes non-existent version updates without verification. This can lead to failed builds, broken pipelines, security vulnerabilities, and unintended changes in production environments. Therefore, ensuring grounded validation and reliable decision-making is critical to prevent propagation of incorrect actions across automated deployment workflows.

---

## Motivation

CI/CD pipelines enable rapid and reliable software delivery but also introduce significant risk as automation scales. In weakly configured environments, even a single unverified action can cascade into failures, security issues, and production instability. This project focuses on building a hallucination-resistant, evidence-driven release intelligence system to ensure safer and more reliable AI-assisted CI/CD workflows.

---

## System Overview

To reduce hallucination in CI/CD workflows, this system uses two techniques:  
(1) Advanced prompting  
(2) Abstention with “I don’t know”

###  Advanced Prompting

#### External Knowledge Restriction
Limits the LLM to use only retrieved, trusted data instead of its internal knowledge, ensuring responses are grounded and verifiable.

#### Iterative Refinement
Reuses the model’s initial output for follow-up prompts to verify, correct, and improve the response.

#### Directional Stimulus Prompting
Guides the model with structured hints to focus on relevant aspects like vendor, version, patch for more precise outputs.

---

###  Abstention

Returns:
> “I don’t know based on available verified data”

- Avoids incorrect or unsafe outputs  
- Ensures only evidence-backed responses  

---

## Implementation & Deployment setup

### Data Source

| Source | Description |
|--------|-------------|
| `ReleaseTrain OS API` | Operating system version and release note data |
| `ReleaseTrain Reddit API` | Community discussions and update references |
| `Vendor Names API` | Vendor normalization and filtering |
| `Internal CSV` | Structured survey and supporting release intelligence data |

---
##  System Pipline Architecture

```text
+-------------+
| User Query  |
+-------------+
       |
       v
+----------------------+
| Intent + Vendor Check|
+----------------------+
       |
       v
+----------------------+
| Retrieve Trusted Data|
| API / Reddit / CSV   |
+----------------------+
       |
       v
+----------------------+
| Prompting Techniques |
| EKR / IR / DSP       |
+----------------------+
       |
       v
+----------------------+
| LLM Response         |
+----------------------+
       |
       v
+----------------------+
| Evidence Check       |
+----------------------+
   |              |
   | enough       | weak
   v              v
+----------+   +-------------+
| Answer   |   | I don't know|
+----------+   +-------------+

```

## Product Demonstration

<p align="center">
  
  <img width="1504" height="866" alt="UI" src="https://github.com/user-attachments/assets/b583f496-8c28-4efd-be22-ae79835bb9e7" />
 
</p>

**Figure 1: User Interface for Prompt Guidance and System Monitoring.**  
The interface guides users in forming structured prompts and provides a dashboard displaying the number of queries responded to, abstained responses, and supported system vendors.

---

<p align="center">
<img width="722" height="418" alt="Response" src="https://github.com/user-attachments/assets/86b42eba-638d-4116-b9a4-1b227cd1a683" />

</p>

**Figure 2: Patch Query Response Based on Intent Detection.**  
The system detects patch-related intent in the query and returns a grounded response, including relevant patch links retrieved from verified sources.

---

<p align="center">

  <img width="1647" height="954" alt="Abstain" src="https://github.com/user-attachments/assets/9cc445d8-4c4c-4dbd-aff3-69ce1119636e" />

</p>

**Figure 3: Abstention Mechanism for Insufficient Evidence.**  
When evidence is insufficient (e.g., unlisted vendors or no patch available for the specified date), the system abstains and returns an “I don’t know” response instead of generating incorrect information.


---


## Future Directions

- Add additional system vendors, expanding those listed in the side navigation bar  
- Extend intent support beyond current version and patch queries to include changelog, CVE, and additional query types  
- Enable prompts that summarize vendor-specific patch, cve counts  
- Support exporting summarized results into `.xlsx` format for reporting and analysis


---
