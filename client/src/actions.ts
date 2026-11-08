import {
    C2S_ChooseActionUnit,
    C2S_DeployGenerals,
    C2S_Discard,
    C2S_NegateRespond,
    C2S_PickGeneral,
    C2S_Respond,
    C2S_UseCard,
    C2S_UseSkill,
    C2S_YieldChoice,
} from 'sgs3v3-shared'
import {
    dispatchLocalChooseActionUnit,
    dispatchLocalDeployGenerals,
    dispatchLocalDiscard,
    dispatchLocalEndTurn,
    dispatchLocalLandlordPick,
    dispatchLocalNegateRespond,
    dispatchLocalPairPick,
    dispatchLocalPickGeneral,
    dispatchLocalRespond,
    dispatchLocalSurrender,
    dispatchLocalUseCard,
    dispatchLocalUseSkill,
    dispatchLocalYieldChoice,
} from './engine/local-dispatch'

/** 页面把玩家操作直接交给浏览器内的引擎；无进行中的单机对局时各 dispatch 自身是空操作 */
export const emit = {
    pickGeneral: (data: C2S_PickGeneral) => dispatchLocalPickGeneral(data.generalId),

    landlordPick: (data: { poolIndex: number; generalId: string }) =>
        dispatchLocalLandlordPick(data.poolIndex, data.generalId),

    pairPick: (data: { seat: number; generalId: string }) =>
        dispatchLocalPairPick(data.seat, data.generalId),

    deployGenerals: (data: C2S_DeployGenerals) =>
        dispatchLocalDeployGenerals(data.commander, data.flankA, data.flankB),

    chooseActionUnit: (data: C2S_ChooseActionUnit) => dispatchLocalChooseActionUnit(data),

    useCard: (data: C2S_UseCard) => dispatchLocalUseCard(data),

    useSkill: (data: C2S_UseSkill) => dispatchLocalUseSkill(data),

    respond: (data: C2S_Respond) => dispatchLocalRespond(data),

    endTurn: () => dispatchLocalEndTurn(),

    discard: (data: C2S_Discard) => dispatchLocalDiscard(data),

    yieldChoice: (data: C2S_YieldChoice) => dispatchLocalYieldChoice(data),

    negateRespond: (data: C2S_NegateRespond) => dispatchLocalNegateRespond(data),

    surrender: () => dispatchLocalSurrender(),
}
