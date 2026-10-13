# RiskCard — FR / EN / ES

## Français

Un rapport partageable du certificat existant : taux d’automatisation du holdout, borne supérieure du risque, budget déclaré, confiance familiale, seuil fixe, effectifs, erreurs et segments. Cette extension rend lisible la preuve fournie ; elle ne certifie ni ne renouvelle une politique. L’étude [Jev benchmarking](https://arxiv.org/abs/2609.37647) motive les évaluations sélectives ; ses résultats ne sont pas attribués à ce package.

```sh
npm ci
npm run demo:riskcard
node dist/cli.js report output/riskcard/certificate.json --html output/private-fr.html --badge output/private-fr.svg --lang fr
```

`output/riskcard` doit être neuf : la démo et la commande n’écrasent jamais les fichiers. Les sorties sont créées avec permissions 600. Le rapport est un fichier HTML autonome sans JavaScript, appels réseau ou moteur. Le badge SVG peut être partagé après examen des métadonnées. Le rapport contient noms du workflow/segments, modèle et empreintes ; il ne contient aucune décision brute, donnée textuelle ou clé privée. Les données et motifs du certificat gardent leur langue originale.

Pour une signature Ed25519, ajouter `--public key.pem --require-signature`. Une signature fournie sans clé est explicitement non vérifiée et le badge n’annonce pas une preuve validée. Une clé erronée ou une preuve incohérente bloque le rapport. Un certificat expiré ou futur est signalé, même si son statut enregistré était `certified`. La commande sort avec 0 après rendu réussi, 1 si entrée/options/signature/sortie invalides ; le rendu réussi n’est pas une autorisation d’action.

Les métriques décrivent **un seuil fixé** : ce n’est pas le maximum théorique d’automatisation ni une nouvelle courbe optimisée sur le holdout. Les hypothèses d’échantillonnage, l’indépendance des annotations et la représentativité restent nécessaires. La démo utilise 200 décisions synthétiques ; ce n’est pas un benchmark Jev ou une preuve de sécurité en production.

## English

A shareable snapshot of the existing certificate: held-out automation rate, upper risk bound, declared budget, family-wise confidence, fixed threshold, counts, errors and slices. This extension makes supplied evidence readable; it does not certify or renew a policy. [Jev benchmarking](https://arxiv.org/abs/2609.37647) motivates selective evaluation; its results are not attributed to this package.

```sh
npm ci
npm run demo:riskcard
node dist/cli.js report output/riskcard/certificate.json --html output/private-en.html --badge output/private-en.svg --lang en
```

`output/riskcard` must be new: the demo and command never overwrite files. Outputs are created with mode 600. The report is standalone HTML with no JavaScript, network request or model. Share the SVG badge after reviewing metadata. Reports include workflow/slice names, model and hashes; they omit raw decisions, textual data and private keys. Certificate data and reasons retain their original language.

For an Ed25519 signature, add `--public key.pem --require-signature`. A supplied signature without a key is explicitly unverified and the badge does not claim validated evidence. A wrong key or inconsistent evidence blocks rendering. Expired or future certificates are flagged even if the stored status was `certified`. Exit 0 means rendering succeeded, 1 means invalid input/options/signature/output; successful rendering is not action authorization.

Metrics describe **one fixed threshold**, not a theoretical maximum automation rate or a new curve optimized on holdout data. Sampling assumptions, independent labels and representativeness remain necessary. The demo uses 200 synthetic decisions; it is no Jev benchmark or production safety evidence.

## Español

Una instantánea compartible del certificado existente: tasa de automatización del holdout, límite superior del riesgo, presupuesto declarado, confianza familiar, umbral fijo, recuentos, errores y segmentos. La extensión hace legible la prueba aportada; no certifica ni renueva políticas. [Jev benchmarking](https://arxiv.org/abs/2609.37647) motiva la evaluación selectiva; sus resultados no se atribuyen a este paquete.

```sh
npm ci
npm run demo:riskcard
node dist/cli.js report output/riskcard/certificate.json --html output/private-es.html --badge output/private-es.svg --lang es
```

`output/riskcard` debe ser nuevo: demo y comando nunca sobrescriben archivos. Las salidas se crean con permisos 600. El informe es HTML autónomo sin JavaScript, solicitudes de red ni modelo. Compartir el badge SVG tras revisar los metadatos. Los informes incluyen nombres de workflow/segmentos, modelo y huellas; no incluyen decisiones brutas, datos textuales ni claves privadas. Datos y motivos del certificado conservan su idioma original.

Para una firma Ed25519, añadir `--public key.pem --require-signature`. Una firma aportada sin clave se marca como no verificada y el badge no afirma una prueba validada. Una clave errónea o pruebas incoherentes bloquean el informe. Los certificados caducados o futuros se señalan aunque su estado guardado fuera `certified`. La salida 0 significa renderizado correcto, 1 entrada/opciones/firma/salida no válidas; renderizar no autoriza acciones.

Las métricas describen **un umbral fijo**, no un máximo teórico de automatización ni una curva nueva optimizada sobre el holdout. Siguen siendo necesarias las hipótesis de muestreo, independencia de anotaciones y representatividad. La demo usa 200 decisiones sintéticas; no es un benchmark Jev ni prueba de seguridad en producción.
