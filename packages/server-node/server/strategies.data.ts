// 本文件由 server/tools/extract-strategies.ts 生成——勿手改。
// 重算:npm run data:strategies(输入:data/raw werewolf Youtube split + split-manifest seed=1)
// 实测分布与簇计数见 data/normalized/strategy-extraction-report.json。
import type { Strategy } from './schema.js';

/** transfer 策略原型:werewolf-among-us train split 句级说服策略标注的实测分布。 */
export const TRANSFER_STRATEGIES: readonly Strategy[] = [
  {
    "id": "interrogator-probe",
    "version": 2,
    "role": "any",
    "persona": "质询试探",
    "tactics": [
      "多用提问收集信息、试探他人反应",
      "直接点名怀疑对象并施压",
      "被怀疑时正面回应、澄清自身"
    ],
    "specificity": 0.207,
    "novelty": 0.471,
    "risk": 0.265,
    "provenance": {
      "kind": "transfer",
      "sampleIds": [
        "werewolf-among-us:part4:Game10:aa7193a0",
        "werewolf-among-us:part13:Game1:929c7daf",
        "werewolf-among-us:part2:Game1:288734b2",
        "werewolf-among-us:part10:Game3:164367e4",
        "werewolf-among-us:part2:Game1:f8f8cd96"
      ]
    }
  },
  {
    "id": "defender-guard",
    "version": 2,
    "role": "any",
    "persona": "稳守辩护",
    "tactics": [
      "被怀疑时正面回应、澄清自身",
      "直接点名怀疑对象并施压",
      "多用提问收集信息、试探他人反应"
    ],
    "specificity": 0.205,
    "novelty": 0.266,
    "risk": 0.232,
    "provenance": {
      "kind": "transfer",
      "sampleIds": [
        "werewolf-among-us:part8:Game4:fc403caf",
        "werewolf-among-us:part10:Game3:164367e4",
        "werewolf-among-us:part12:Game1:1d1715cc",
        "werewolf-among-us:part3:Game5:d2130cb7",
        "werewolf-among-us:part10:Game1:4475043d"
      ]
    }
  },
  {
    "id": "accuser-pressure",
    "version": 2,
    "role": "any",
    "persona": "直接施压",
    "tactics": [
      "直接点名怀疑对象并施压",
      "多用提问收集信息、试探他人反应",
      "被怀疑时正面回应、澄清自身"
    ],
    "specificity": 0.196,
    "novelty": 0.269,
    "risk": 0.486,
    "provenance": {
      "kind": "transfer",
      "sampleIds": [
        "werewolf-among-us:part4:Game10:aa7193a0",
        "werewolf-among-us:part2:Game1:288734b2",
        "werewolf-among-us:part7:Game3:152c9bb1",
        "werewolf-among-us:part13:Game1:929c7daf",
        "werewolf-among-us:part1:Game1:699be497"
      ]
    }
  },
  {
    "id": "informer-anchor",
    "version": 2,
    "role": "any",
    "persona": "举证定调",
    "tactics": [
      "引用场上可核查的细节作依据",
      "被怀疑时正面回应、澄清自身",
      "多用提问收集信息、试探他人反应"
    ],
    "specificity": 0.353,
    "novelty": 0.316,
    "risk": 0.264,
    "provenance": {
      "kind": "transfer",
      "sampleIds": [
        "werewolf-among-us:part8:Game4:fc403caf",
        "werewolf-among-us:part13:Game1:a0bbbaa4",
        "werewolf-among-us:part16:Game2:772b4f7b",
        "werewolf-among-us:part11:Game4:1a8797c3",
        "werewolf-among-us:part12:Game1:65dcadd0"
      ]
    }
  }
];
