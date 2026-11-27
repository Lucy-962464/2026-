import {RULES} from './model.mjs';

export const QUESTIONNAIRE_VERSION='V1.3';
export const QUESTIONS={
  preference:{
    title:'根据刚才的游戏体验，您希望下一轮的菜品数量怎样变化？',
    options:[
      ['increase','增加一些，比现在多一些。'],['keep','保持现在的菜品数量。'],
      ['decrease','减少一些，比现在少一些。'],['unsure','暂时说不清，没有特别的想法。']
    ]
  },
  difficulty:{
    title:'菜品数量调整后，您完成刚才这几轮时，觉得现在的游戏难度怎么样？',
    options:[
      ['very_easy','非常容易。'],['easy','比较容易。'],['appropriate','难度正合适。'],
      ['hard','比较困难。'],['very_hard','非常困难。'],['unsure','暂时说不清，还没有适应。']
    ]
  }
};

function context(kind,row,decision,validTrials) {
  return {
    question_kind:kind,questionnaire_version:QUESTIONNAIRE_VERSION,
    trial_no:row.trial,story_level:row.level,decision_trial_no:decision.trial,
    dish_count_before:decision.size,dish_count_after:decision.nextSize,
    algorithm_action:decision.correct>=RULES.up?1:decision.correct<=RULES.down?-1:0,
    actual_action:Math.sign(decision.nextSize-decision.size),valid_trials:validTrials
  };
}

export function stageFeedback(before,after) {
  const row=after.state.trials.at(-1);
  if(!row?.valid) return after;
  const change=before.state.lastChange;
  const validTrials=after.state.trials.filter(t=>t.trial>(change??0)&&t.valid&&t.size===row.size).length;
  const questions=[];
  if(change!==null&&validTrials===3) {
    const decision=after.state.trials[change-1];
    if(decision.nextSize===row.size&&decision.size!==row.size)
      questions.push(context('difficulty',row,decision,validTrials));
  }
  if(row.settled&&row.nextSize!==null) questions.push(context('preference',row,row,validTrials));
  if(!questions.length) return after;
  return {...after,state:before.state,feedbackGate:{state:after.state,questions}};
}

export function answerFeedback(session,choice,at=new Date().toISOString()) {
  const gate=session.feedbackGate;
  if(!gate) return session;
  const [question,...questions]=gate.questions;
  if(!QUESTIONS[question.question_kind].options.some(([value])=>value===choice)) return session;
  const response={...question,
    preference_response:question.question_kind==='preference'?choice:null,
    difficulty_response:question.question_kind==='difficulty'?choice:null,
    response_time:at
  };
  return {...session,
    state:questions.length?session.state:gate.state,
    feedbackGate:questions.length?{...gate,questions}:null,
    questionnaireResponses:[...(session.questionnaireResponses??[]),response]
  };
}
