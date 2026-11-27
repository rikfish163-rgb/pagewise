import { useLocale } from './LocaleProvider';
import type {PublicProfile} from './PersonalApi';
import './personal-picker.css';

export default function PersonalModelPicker({profile,model,choose,image}:{profile:PublicProfile;model:string;choose:(id:string)=>void;image:boolean}){
  const { t } = useLocale();
 const vision=(profile.visionModels??(profile.vision?[profile.model]:[])).includes(model);
 return <div className="personal-picker">
  <label>{t("自带模型")}<select aria-label={t("本次提问使用的自带模型")} value={model} onChange={e=>choose(e.target.value)}>{(profile.models??[profile.model]).map(id=><option key={id} value={id}>{id}</option>)}</select></label>
  <small>{t("{0} · 发送至 {1}", { 0: vision?t('图片已验证'):image?t('未验证看图，请在模型来源中测试此型号或切换模型。'):t('仅文字'), 1: new URL(profile.base).host })}</small>
 </div>;
}
