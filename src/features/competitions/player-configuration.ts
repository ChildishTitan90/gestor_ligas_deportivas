import type {PlayerPolicy} from "./player-policy";
export type PlayerConfigurationWorkspace={actorId:string;season:{id:string;name:string;version:number;status:string};canEdit:boolean;canApprove:boolean;
  categories:{id:string;type:string;name:string;policy:PlayerPolicy|null}[];
  levels:{season_category_id:string;pathway_code:string;level:number}[]};
