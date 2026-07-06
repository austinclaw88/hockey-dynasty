// Bundles all 32 team data files at build time so the app (and the
// single-file build) is fully self-contained.
import type { TeamDataFile, FreeAgentPoolFile, DraftClassFile } from '../types'

import faData from '../../data/free-agents.json'
import draft2027Data from '../../data/draft-2027.json'
import ANA from '../../data/teams/ANA.json'
import BOS from '../../data/teams/BOS.json'
import BUF from '../../data/teams/BUF.json'
import CAR from '../../data/teams/CAR.json'
import CBJ from '../../data/teams/CBJ.json'
import CGY from '../../data/teams/CGY.json'
import CHI from '../../data/teams/CHI.json'
import COL from '../../data/teams/COL.json'
import DAL from '../../data/teams/DAL.json'
import DET from '../../data/teams/DET.json'
import EDM from '../../data/teams/EDM.json'
import FLA from '../../data/teams/FLA.json'
import LAK from '../../data/teams/LAK.json'
import MIN from '../../data/teams/MIN.json'
import MTL from '../../data/teams/MTL.json'
import NJD from '../../data/teams/NJD.json'
import NSH from '../../data/teams/NSH.json'
import NYI from '../../data/teams/NYI.json'
import NYR from '../../data/teams/NYR.json'
import OTT from '../../data/teams/OTT.json'
import PHI from '../../data/teams/PHI.json'
import PIT from '../../data/teams/PIT.json'
import SEA from '../../data/teams/SEA.json'
import SJS from '../../data/teams/SJS.json'
import STL from '../../data/teams/STL.json'
import TBL from '../../data/teams/TBL.json'
import TOR from '../../data/teams/TOR.json'
import UTA from '../../data/teams/UTA.json'
import VAN from '../../data/teams/VAN.json'
import VGK from '../../data/teams/VGK.json'
import WPG from '../../data/teams/WPG.json'
import WSH from '../../data/teams/WSH.json'

export const TEAM_DATA: TeamDataFile[] = [
  ANA, BOS, BUF, CAR, CBJ, CGY, CHI, COL, DAL, DET, EDM, FLA, LAK, MIN, MTL, NJD,
  NSH, NYI, NYR, OTT, PHI, PIT, SEA, SJS, STL, TBL, TOR, UTA, VAN, VGK, WPG, WSH,
] as TeamDataFile[]

/** Real unsigned 2026 UFAs seeded into the first free-agency window. */
export const FA_POOL: FreeAgentPoolFile = faData as FreeAgentPoolFile

/** Real projected 2027 draft class seeding the FIRST in-game entry draft. */
export const DRAFT_2027: DraftClassFile = draft2027Data as DraftClassFile
