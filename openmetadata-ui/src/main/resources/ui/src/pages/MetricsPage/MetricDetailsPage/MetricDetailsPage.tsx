/*
 *  Copyright 2024 Collate.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  http://www.apache.org/licenses/LICENSE-2.0
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { AxiosError } from 'axios';
import { compare } from 'fast-json-patch';
import { isUndefined, omitBy, toString } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';

import ErrorPlaceHolder from '../../../components/common/ErrorWithPlaceholder/ErrorPlaceHolder';
import Loader from '../../../components/common/Loader/Loader';
import { QueryVote } from '../../../components/Database/TableQueries/TableQueries.interface';
import MetricDetails from '../../../components/Metric/MetricDetails/MetricDetails';
import { getVersionPath, ROUTES } from '../../../constants/constants';
import { usePermissionProvider } from '../../../context/PermissionProvider/PermissionProvider';
import {
  OperationPermission,
  ResourceEntity,
} from '../../../context/PermissionProvider/PermissionProvider.interface';
import { ClientErrors } from '../../../enums/Axios.enum';
import { ERROR_PLACEHOLDER_TYPE } from '../../../enums/common.enum';
import { EntityType, TabSpecificField } from '../../../enums/entity.enum';
import { CreateThread } from '../../../generated/api/feed/createThread';
import { Metric } from '../../../generated/entity/data/metric';
import { useApplicationStore } from '../../../hooks/useApplicationStore';
import { useFqn } from '../../../hooks/useFqn';
import { postThread } from '../../../rest/feedsAPI';
import {
  addMetricFollower,
  getMetricByFqn,
  patchMetric,
  removeMetricFollower,
  updateMetricVote,
} from '../../../rest/metricsAPI';
import {
  addToRecentViewed,
  getEntityMissingError,
  sortTagsCaseInsensitive,
} from '../../../utils/CommonUtils';
import { getEntityName } from '../../../utils/EntityUtils';
import { DEFAULT_ENTITY_PERMISSION } from '../../../utils/PermissionsUtils';
import { showErrorToast } from '../../../utils/ToastUtils';

const MetricDetailsPage = () => {
  const { t } = useTranslation();
  const { currentUser } = useApplicationStore();
  const currentUserId = currentUser?.id ?? '';
  const history = useHistory();
  const { getEntityPermissionByFqn } = usePermissionProvider();

  const { fqn: metricFqn } = useFqn();
  const [metricDetails, setMetricDetails] = useState<Metric>({} as Metric);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [isError, setIsError] = useState(false);

  const [metricPermissions, setMetricPermissions] =
    useState<OperationPermission>(DEFAULT_ENTITY_PERMISSION);

  const { id: metricId, version: currentVersion } = metricDetails;

  const saveUpdatedMetricData = (updatedData: Metric) => {
    const jsonPatch = compare(omitBy(metricDetails, isUndefined), updatedData);

    return patchMetric(metricId, jsonPatch);
  };

  const handleMetricUpdate = async (updatedData: Metric, key: keyof Metric) => {
    try {
      const res = await saveUpdatedMetricData(updatedData);

      setMetricDetails((previous) => {
        if (key === 'tags') {
          return {
            ...previous,
            version: res.version,
            [key]: sortTagsCaseInsensitive(res.tags ?? []),
          };
        }

        return {
          ...previous,
          version: res.version,
          [key]: res[key],
        };
      });
    } catch (error) {
      showErrorToast(error as AxiosError);
    }
  };

  const fetchResourcePermission = async (entityFqn: string) => {
    setLoading(true);
    try {
      const permissions = await getEntityPermissionByFqn(
        ResourceEntity.METRIC,
        entityFqn
      );
      setMetricPermissions(permissions);
    } catch (error) {
      showErrorToast(
        t('server.fetch-entity-permissions-error', {
          entity: entityFqn,
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchMetricDetail = async (metricFqn: string) => {
    setLoading(true);
    try {
      const res = await getMetricByFqn(metricFqn, {
        fields: [
          TabSpecificField.OWNERS,
          TabSpecificField.FOLLOWERS,
          TabSpecificField.TAGS,
          TabSpecificField.DOMAIN,
          TabSpecificField.DATA_PRODUCTS,
          TabSpecificField.VOTES,
          TabSpecificField.EXTENSION,
          TabSpecificField.RELATED_METRICS,
        ].join(','),
      });
      const { id, fullyQualifiedName } = res;

      setMetricDetails(res);

      addToRecentViewed({
        displayName: getEntityName(res),
        entityType: EntityType.METRIC,
        fqn: fullyQualifiedName ?? '',
        timestamp: 0,
        id: id,
      });
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        setIsError(true);
      } else if (
        (error as AxiosError)?.response?.status === ClientErrors.FORBIDDEN
      ) {
        history.replace(ROUTES.FORBIDDEN);
      } else {
        showErrorToast(
          error as AxiosError,
          t('server.entity-details-fetch-error', {
            entityType: t('label.metric'),
            entityName: metricFqn,
          })
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const followMetric = async () => {
    try {
      const res = await addMetricFollower(metricId, currentUserId);
      const { newValue } = res.changeDescription.fieldsAdded[0];
      setMetricDetails((prev) => ({
        ...prev,
        followers: [...(prev?.followers ?? []), ...newValue],
      }));
    } catch (error) {
      showErrorToast(
        error as AxiosError,
        t('server.entity-follow-error', {
          entity: getEntityName(metricDetails),
        })
      );
    }
  };

  const unFollowMetric = async () => {
    try {
      const res = await removeMetricFollower(metricId, currentUserId);
      const { oldValue } = res.changeDescription.fieldsDeleted[0];
      setMetricDetails((prev) => ({
        ...prev,
        followers: (prev?.followers ?? []).filter(
          (follower) => follower.id !== oldValue[0].id
        ),
      }));
    } catch (error) {
      showErrorToast(
        error as AxiosError,
        t('server.entity-unfollow-error', {
          entity: getEntityName(metricDetails),
        })
      );
    }
  };

  const versionHandler = () => {
    currentVersion &&
      history.push(
        getVersionPath(EntityType.METRIC, metricFqn, toString(currentVersion))
      );
  };

  const handleCreateThread = async (data: CreateThread) => {
    try {
      await postThread(data);
    } catch (error) {
      showErrorToast(
        error as AxiosError,
        t('server.create-entity-error', {
          entity: t('label.conversation'),
        })
      );
    }
  };

  const handleToggleDelete = (version?: number) => {
    setMetricDetails((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        deleted: !prev?.deleted,
        ...(version ? { version } : {}),
      };
    });
  };

  const handleUpdateVote = async (data: QueryVote, id: string) => {
    try {
      await updateMetricVote(id, data);
      const details = await getMetricByFqn(metricFqn, {
        fields: [
          TabSpecificField.OWNERS,
          TabSpecificField.FOLLOWERS,
          TabSpecificField.TAGS,
          TabSpecificField.VOTES,
        ].join(','),
      });
      setMetricDetails(details);
    } catch (error) {
      showErrorToast(error as AxiosError);
    }
  };

  const updateMetricDetails = useCallback((data) => {
    const updatedData = data as Metric;

    setMetricDetails((data) => ({
      ...(data ?? updatedData),
      version: updatedData.version,
    }));
  }, []);

  useEffect(() => {
    fetchResourcePermission(metricFqn);
  }, [metricFqn]);

  useEffect(() => {
    if (metricPermissions.ViewAll || metricPermissions.ViewBasic) {
      fetchMetricDetail(metricFqn);
    }
  }, [metricPermissions, metricFqn]);

  if (isLoading) {
    return <Loader />;
  }
  if (isError) {
    return (
      <ErrorPlaceHolder>
        {getEntityMissingError(EntityType.METRIC, metricFqn)}
      </ErrorPlaceHolder>
    );
  }
  if (!metricPermissions.ViewAll && !metricPermissions.ViewBasic) {
    return <ErrorPlaceHolder type={ERROR_PLACEHOLDER_TYPE.PERMISSION} />;
  }

  return (
    <MetricDetails
      fetchMetricDetails={() => fetchMetricDetail(metricFqn)}
      metricDetails={metricDetails}
      metricPermissions={metricPermissions}
      onCreateThread={handleCreateThread}
      onFollowMetric={followMetric}
      onMetricUpdate={handleMetricUpdate}
      onToggleDelete={handleToggleDelete}
      onUnFollowMetric={unFollowMetric}
      onUpdateMetricDetails={updateMetricDetails}
      onUpdateVote={handleUpdateVote}
      onVersionChange={versionHandler}
    />
  );
};

export default MetricDetailsPage;
