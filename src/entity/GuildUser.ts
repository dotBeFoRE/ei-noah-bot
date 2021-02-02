import {
  Entity, ManyToOne, OneToMany, Collection, PrimaryKey, Unique, OneToOne,
} from '@mikro-orm/core';
// eslint-disable-next-line import/no-cycle
import { User } from './User';
// eslint-disable-next-line import/no-cycle
import { Guild } from './Guild';
// eslint-disable-next-line import/no-cycle
import Quote from './Quote';
// eslint-disable-next-line import/no-cycle
import TempChannel from './TempChannel';

@Entity()
@Unique({ properties: ['guild', 'user'] })
// eslint-disable-next-line import/prefer-default-export
export class GuildUser {
  @PrimaryKey()
  id!: number;

  @ManyToOne({ eager: true, entity: 'Guild' })
  guild!: Guild;

  @ManyToOne({ eager: true, entity: 'User' })
  user!: User;

  @OneToOne({
    entity: 'TempChannel', mappedBy: 'guildUser', eager: true,
  })
  tempChannel?: TempChannel;

  @OneToMany({ entity: () => Quote, mappedBy: 'guildUser' })
  quotes = new Collection<Quote>(this);

  @OneToMany({ entity: () => Quote, mappedBy: 'creator' })
  createdQuotes = new Collection<Quote>(this);
}
